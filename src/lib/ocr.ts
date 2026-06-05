// Browser-side OCR for devices that ship credentials printed on a label
// instead of (or alongside) a QR code. Wraps Tesseract.js — its WASM core
// (~2 MB) and English language data (~15 MB) are downloaded on first use
// and then cached by the browser. Subsequent recognitions run from cache.
//
// Dynamic import keeps Tesseract out of the initial bundle. The worker is
// created lazily on the first recognize() call and reused across calls,
// because spinning up a fresh worker costs ~3 s.

import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | undefined;

const getWorker = async (): Promise<Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      // Constrain the recognized alphabet to characters likely to appear on
      // LoRaWAN device labels (hex digits + the usual byte-group separators).
      // Cuts the candidate set sharply — Tesseract is more accurate when it
      // doesn't have to consider every printable glyph.
      await worker.setParameters({
        tessedit_char_whitelist:
          '0123456789ABCDEFabcdef:.-_ \nDevEUIJoinAppKeyNwksrlfM',
      });
      return worker;
    })();
  }
  return workerPromise;
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

/**
 * Run OCR on a canvas / image / image URL.
 *
 * Pipe the returned `text` through
 * `@intelligent-farming/lorawan-qr-decoder`'s `parse()` — its strategies
 * already extract EUIs/keys from labeled token-soup.
 */
export const recognizeText = async (
  source: HTMLCanvasElement | HTMLImageElement | ImageData | Blob | string,
): Promise<OcrResult> => {
  const worker = await getWorker();
  const { data } = await worker.recognize(source);
  return {
    text: stitchContinuationLines(normalizeLabels(data.text)),
    rawText: data.text,
    confidence: data.confidence,
  };
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
