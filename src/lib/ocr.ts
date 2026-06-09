// Browser-side OCR for devices that ship credentials printed on a label
// instead of (or alongside) a QR code. Wraps Tesseract.js — its WASM core
// (~2 MB) and English language data (~15 MB) are downloaded on first use
// and then cached by the browser. Subsequent recognitions run from cache.
//
// Dynamic import keeps Tesseract out of the initial bundle. The worker is
// created lazily on the first recognize() call and reused across calls,
// because spinning up a fresh worker costs ~3 s.
//
// Small, glossy, low-contrast labels on budget hardware are the hard case.
// Two levers help before Tesseract even runs: (1) configure the engine for a
// constrained alphabet, the LSTM model, and a single block of text; (2) feed
// it a cleaned-up image — upscaled, grayscaled, and binarized (see
// `toBinarizedCanvas`). Raw camera frames of tiny print read poorly without
// this pre-pass.

import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | undefined;

const getWorker = async (): Promise<Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      // LSTM-only engine: more accurate on the kind of dense alphanumeric
      // strings (EUIs, keys) we care about than the legacy/combined modes.
      const worker = await createWorker('eng', OEM.LSTM_ONLY);
      await worker.setParameters({
        // A device label is one compact block of text, not a page of prose.
        // SINGLE_BLOCK stops Tesseract from hunting for paragraph/column
        // structure that isn't there.
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        // Constrain the recognized alphabet to characters likely to appear on
        // LoRaWAN device labels (hex digits + the usual byte-group separators).
        // Cuts the candidate set sharply — Tesseract is more accurate when it
        // doesn't have to consider every printable glyph.
        tessedit_char_whitelist:
          '0123456789ABCDEFabcdef:.-_ \nDevEUIJoinAppKeyNwksrlfM',
      });
      return worker;
    })();
  }
  return workerPromise;
};

// Target working resolution for the longest edge before OCR. Small frames get
// upscaled (more pixels per glyph helps the LSTM); huge phone-camera frames get
// downscaled so a multi-orientation pass doesn't take forever. Tuned to keep a
// single recognize() in the ~1 s range.
const TARGET_MIN_EDGE = 1200;
const TARGET_MAX_EDGE = 2200;
const MAX_SCALE = 3;

/** Pick a bounded scale factor that brings the longest edge into target range. */
const scaleFor = (longestEdge: number): number => {
  if (longestEdge <= 0) return 1;
  if (longestEdge < TARGET_MIN_EDGE) return Math.min(MAX_SCALE, TARGET_MIN_EDGE / longestEdge);
  if (longestEdge > TARGET_MAX_EDGE) return TARGET_MAX_EDGE / longestEdge;
  return 1;
};

/**
 * Otsu's method: pick the grayscale threshold that maximizes between-class
 * variance, i.e. the value that best separates "ink" from "background" for a
 * bimodal histogram. Standard, parameter-free, and a good fit for printed
 * labels (dark text on a light sticker, or the reverse).
 */
const otsuThreshold = (hist: number[], total: number): number => {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVariance) {
      maxVariance = between;
      threshold = t;
    }
  }
  return threshold;
};

/**
 * Clean up a captured frame for OCR: upscale, grayscale, then binarize with an
 * Otsu threshold. The output is normalized to dark text on a white background
 * regardless of the label's actual polarity (some labels are light-on-dark),
 * which is what Tesseract reads best.
 *
 * Rotates the source by `rotationDeg` (clockwise) first — credential labels are
 * often printed sideways along a device edge, and Tesseract won't auto-rotate
 * with a fixed page-segmentation mode, so the caller sweeps orientations.
 *
 * Falls back to returning the source untouched if a 2D context isn't available.
 */
const toBinarizedCanvas = (
  source: HTMLCanvasElement | HTMLImageElement,
  rotationDeg = 0,
): HTMLCanvasElement => {
  const srcW = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const srcH = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  const scale = scaleFor(Math.max(srcW, srcH));
  const sw = Math.max(1, Math.round(srcW * scale));
  const sh = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  // A 90°/270° turn swaps the canvas dimensions.
  const quarterTurn = rotationDeg === 90 || rotationDeg === 270;
  const w = quarterTurn ? sh : sw;
  const h = quarterTurn ? sw : sh;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source instanceof HTMLCanvasElement ? source : canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    // Rec. 601 luma — good enough for a binarization pre-pass.
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[p] = g;
    hist[g]++;
  }

  const threshold = otsuThreshold(hist, n);
  // Decide polarity: on a typical label the background (lighter side) is the
  // majority. If it isn't, the label is light-on-dark and we invert so text
  // still ends up black.
  let aboveCount = 0;
  for (let p = 0; p < n; p++) if (gray[p] >= threshold) aboveCount++;
  const backgroundIsLight = aboveCount >= n / 2;

  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const isLowerBand = gray[p] < threshold;
    // Text should render black, background white.
    const isText = backgroundIsLight ? isLowerBand : !isLowerBand;
    const v = isText ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
};

export interface OcrResult {
  /**
   * OCR'd text with continuation lines stitched onto their preceding labeled
   * line. Pipe this through `parseQr` — the hex-scan / key-value strategies
   * expect each labeled value on one line.
   */
  text: string;
  /** Raw OCR output before stitching. Useful for diagnostics. */
  rawText: string;
  /** 0–100, from Tesseract. Useful as a sanity check, not a strict gate. */
  confidence: number;
}

const LABEL_PREFIX_RE = /^[A-Za-z][A-Za-z_-]*\s*[=:]/;
const HEX_OR_SEP_ONLY_RE = /^[0-9A-Fa-f\s:.\-]+$/;

/**
 * Collapse common multi-word LoRaWAN label spellings down to the compact form
 * the qr-decoder's key/value parser understands. Device stickers commonly use
 * `APP KEY:` / `DEV EUI:` / `APP EUI:` (with a space), but the parser's key
 * pattern is `[A-Za-z][A-Za-z_-]*` — single word, no spaces. Without this
 * pre-pass the labeled line silently fails to parse and the value never
 * reaches `extractKeyValues`.
 *
 * Order matters: run this *before* `stitchContinuationLines`, because that
 * step also uses the single-word label regex to decide what counts as a
 * labeled line worth stitching onto.
 */
const LABEL_NORMALIZATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDEV\s+EUI\b/gi, 'DevEUI'],
  [/\bJOIN\s+EUI\b/gi, 'JoinEUI'],
  [/\bAPP\s+EUI\b/gi, 'AppEUI'],
  [/\bAPP\s+KEY\b/gi, 'AppKey'],
  [/\bNWK\s+KEY\b/gi, 'NwkKey'],
  [/\bNETWORK\s+KEY\b/gi, 'NwkKey'],
];

export const normalizeLabels = (text: string): string =>
  LABEL_NORMALIZATIONS.reduce((s, [re, replacement]) => s.replace(re, replacement), text);

/**
 * Glue label-less continuation lines onto the previous labeled line.
 *
 * LoRaWAN device labels routinely print 32-hex AppKeys on two lines because
 * they're too long to fit horizontally. Without this step:
 *
 *     AppKey:  A6 6A 89 B6 60 6C 1B D1
 *              25 B5 4E 7C A4 B1 0D D4
 *
 * gets parsed as two separate key/value pairs — the first taking only the
 * 16-hex first half (which then fails the 32-hex AppKey validator and gets
 * dropped), and the second matching no key at all.
 *
 * The stitcher only joins a line onto the previous one when:
 *   1. The previous line starts with a `Word:` / `Word=` label, AND
 *   2. The current line is pure hex/separator characters (no label).
 *
 * This avoids over-stitching naked-hex output where each line is a complete
 * EUI on its own.
 */
export const stitchContinuationLines = (text: string): string => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    const isContinuation =
      previous !== undefined
      && LABEL_PREFIX_RE.test(previous)
      && HEX_OR_SEP_ONLY_RE.test(line)
      && !LABEL_PREFIX_RE.test(line);
    if (isContinuation) {
      out[out.length - 1] = `${previous} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
};

export interface RecognizeOptions {
  /**
   * Orientations (degrees, clockwise) to try, in order. Default `[0]`. Credential
   * labels are often printed sideways, so the Session page sweeps `[0, 90, 270,
   * 180]`. Only honored for drawable sources (canvas / image) — others run once.
   */
  orientations?: number[];
  /**
   * Optional domain check applied after each orientation. Return `true` to stop
   * early with that result (e.g. when `parseQr` extracted a valid DevEUI), so a
   * good rotation short-circuits the rest. When no orientation is accepted, the
   * highest-confidence result is returned.
   */
  accept?: (result: OcrResult) => boolean;
}

/**
 * Run OCR on a canvas / image / image URL.
 *
 * Pipe the returned `text` through
 * `@intelligent-farming/lorawan-qr-decoder`'s `parse()` — its strategies
 * already extract EUIs/keys from labeled token-soup.
 */
export const recognizeText = async (
  source: HTMLCanvasElement | HTMLImageElement | ImageData | Blob | string,
  opts: RecognizeOptions = {},
): Promise<OcrResult> => {
  const worker = await getWorker();
  // Binarize drawable sources (the Session page hands us a captured video
  // frame). Pass ImageData / Blob / URL sources straight through — they may
  // not be safely drawable here, and can't be rotated, so they run once.
  const drawable =
    source instanceof HTMLCanvasElement || source instanceof HTMLImageElement;
  const orientations = drawable && opts.orientations?.length ? opts.orientations : [0];

  let best: OcrResult | undefined;
  for (const deg of orientations) {
    const prepared = drawable ? toBinarizedCanvas(source, deg) : source;
    const { data } = await worker.recognize(prepared);
    const result: OcrResult = {
      text: stitchContinuationLines(normalizeLabels(data.text)),
      rawText: data.text,
      confidence: data.confidence,
    };
    if (opts.accept?.(result)) return result;
    if (!best || result.confidence > best.confidence) best = result;
  }
  // `best` is always set — the loop runs at least once.
  return best as OcrResult;
};

/**
 * Tear the OCR worker down — only useful when you're sure no more OCR
 * calls are coming (page unmount, end-of-session). Skipping this is fine;
 * the worker is just an inactive WebWorker.
 */
export const terminateOcr = async (): Promise<void> => {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } finally {
    workerPromise = undefined;
  }
};
