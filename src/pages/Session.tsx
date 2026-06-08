import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Divider, FormControlLabel,
  Grid, IconButton, InputAdornment, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';

import { AppShell } from '../components/AppShell';
import StopIcon from '@mui/icons-material/Stop';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import {
  isDevEui, isJoinEui, isAppKey, parseDevEui, parseJoinEui, parseAppKey,
} from '@intelligent-farming/lorawan-credential-format';

import {
  createChirpStackClient, ChirpStackApiError,
} from '../lib/chirpstack-api';
import { parseQr } from '../lib/oui';
import { recognizeText } from '../lib/ocr';
import { beepError, beepScan, beepSuccess } from '../lib/audio';
import { QrScanner, type QrScannerHandle } from '../components/QrScanner';
import { useSettings } from '../state/settings';
import { useSession, type Submission, type SubmissionStatus } from '../state/session';
import { i18n, useT } from '../i18n';

/**
 * One device scanned into the multi-device queue. All fields are normalized
 * (uppercase hex, no separators). `joinEui` is the "brand EUI" used to verify
 * every queued device is the same model — see {@link SessionPage}'s scan path.
 * `appKey` may be absent if the QR code didn't carry it; that device then
 * fails at bulk-add time and is reported in the failed list.
 */
interface QueuedDevice {
  /**
   * Stable per-row identity. DevEUI and JoinEUI can repeat across a batch
   * (only the AppKey is reliably unique), so rows are keyed on this instead
   * of any scanned field — used for React keys, removal, and failure tracking.
   */
  id: string;
  devEui: string;
  joinEui?: string;
  appKey?: string;
}

const fmtElapsed = (startIso: string): string => {
  const ms = Date.now() - new Date(startIso).getTime();
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => n.toString().padStart(2, '0')).join(':');
};

export function SessionPage() {
  const settings = useSettings();
  const active = useSession((s) => s.active);
  const submissions = useSession((s) => s.submissions);
  const endSession = useSession((s) => s.endSession);
  const recordSubmission = useSession((s) => s.recordSubmission);
  const markCreated = useSession((s) => s.markCreated);
  const markFailed = useSession((s) => s.markFailed);
  const navigate = useNavigate();
  const t = useT();

  // Redirect away if there's no active session.
  useEffect(() => {
    if (!active) navigate('/session/new', { replace: true });
  }, [active, navigate]);

  // Tick once a second so the elapsed-time header stays fresh.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Form state. JoinEUI is sticky across submissions (often vendor-default
  // for a whole batch); DevEUI + AppKey + NwkKey clear after each success.
  // NwkKey is only shown for LoRaWAN 1.1.x devices — see `needsSeparateNwkKey`.
  const [devEui, setDevEui] = useState('');
  const [joinEui, setJoinEui] = useState('');
  const [appKey, setAppKey] = useState('');
  const [nwkKey, setNwkKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [lastScanInfo, setLastScanInfo] = useState<string | undefined>();
  const [lastOcrText, setLastOcrText] = useState<string | undefined>();
  const [scannerActive, setScannerActive] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  // Multi-device mode: scan many of the same model into a queue, then add them
  // all to ChirpStack in one pass. Replaces the single-device text inputs.
  const [multiMode, setMultiMode] = useState(false);
  const [queue, setQueue] = useState<QueuedDevice[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [brandAlert, setBrandAlert] = useState<string | undefined>();
  const [bulkResult, setBulkResult] = useState<{ ok: string[]; failed: { id: string; error: string }[] } | undefined>();
  const devEuiRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<QrScannerHandle | null>(null);
  // LoRaWAN 1.0.x uses a single root key (sent to ChirpStack as `nwkKey`).
  // LoRaWAN 1.1.x splits it into a separate NwkKey (network path) and AppKey
  // (data path); both must be supplied. Detect from the active session's
  // MAC version captured at session-setup time.
  const needsSeparateNwkKey = /^LORAWAN_1_1/.test(active?.macVersion ?? '');
  // Latest values for the submit callback — avoids stale-closure issues
  // when the QR scanner fires while the React tree is mid-render.
  const latest = useRef({ devEui, joinEui, appKey, nwkKey, submitting });
  latest.current = { devEui, joinEui, appKey, nwkKey, submitting };
  // The QrScanner captures its `onScan` once at mount (see QrScanner.tsx), so
  // the scan handler can't close over live state. Mirror everything the scan
  // path needs into refs and read them at call time.
  const scanState = useRef({ multiMode, audioEnabled });
  scanState.current = { multiMode, audioEnabled };
  const queueRef = useRef<QueuedDevice[]>(queue);
  queueRef.current = queue;
  // Monotonic source of per-row ids — see QueuedDevice.id.
  const queueIdRef = useRef(0);
  // The last device scanned while in single mode. When a *second*, different
  // device is scanned we flip to multi mode and seed the queue with both —
  // see onScan. Cleared on submit and when entering multi mode.
  const singleScanRef = useRef<ReturnType<typeof parseQr> | undefined>(undefined);

  if (!active) return null;

  const devEuiValid = !devEui || isDevEui(devEui);
  const joinEuiValid = !joinEui || isJoinEui(joinEui);
  const appKeyValid = !appKey || isAppKey(appKey);
  const nwkKeyValid = !nwkKey || isAppKey(nwkKey);
  const canSubmit =
    isDevEui(devEui)
    && isJoinEui(joinEui)
    && isAppKey(appKey)
    && (!needsSeparateNwkKey || isAppKey(nwkKey))
    && !submitting;

  const submit = useCallback(async (overrides?: { devEui?: string; joinEui?: string; appKey?: string; nwkKey?: string }) => {
    const cur = latest.current;
    const dRaw = overrides?.devEui ?? cur.devEui;
    const jRaw = overrides?.joinEui ?? cur.joinEui;
    const kRaw = overrides?.appKey ?? cur.appKey;
    const nRaw = overrides?.nwkKey ?? cur.nwkKey;
    if (cur.submitting) return;
    if (!isDevEui(dRaw) || !isJoinEui(jRaw) || !isAppKey(kRaw)) return;
    if (needsSeparateNwkKey && !isAppKey(nRaw)) return;
    if (!active) return;

    const normalized = {
      devEui: parseDevEui(dRaw),
      joinEui: parseJoinEui(jRaw),
      appKey: parseAppKey(kRaw),
      nwkKey: needsSeparateNwkKey ? parseAppKey(nRaw) : undefined,
    };
    setError(undefined);
    setSubmitting(true);
    recordSubmission(normalized.devEui);

    const client = createChirpStackClient({
      chirpStackUrl: settings.chirpStackUrl,
      apiKey: settings.apiKey,
    });
    try {
      // 1.0.x: send the form's "AppKey" as `nwkKey` (ChirpStack's convention
      //        for the single root key — `appKey` is unused at this MAC version).
      // 1.1.x: send `nwkKey` (network root) and `appKey` (data root) separately.
      const keys = needsSeparateNwkKey
        ? { nwkKey: normalized.nwkKey!, appKey: normalized.appKey }
        : { nwkKey: normalized.appKey };
      await client.createDevice({
        devEui: normalized.devEui,
        name: `${active.modelName} (${normalized.devEui})`,
        applicationId: active.applicationId,
        deviceProfileId: active.deviceProfileId,
        joinEui: normalized.joinEui,
        keys,
      });
      markCreated(normalized.devEui);
      if (audioEnabled) beepSuccess();
      // Reset for the next device — keep JoinEUI (vendor default for the batch).
      setDevEui('');
      setAppKey('');
      setNwkKey('');
      setLastScanInfo(undefined);
      setLastOcrText(undefined);
      // This device is added — the next scan starts a fresh "first scan".
      singleScanRef.current = undefined;
      devEuiRef.current?.focus();
    } catch (err) {
      const msg = err instanceof ChirpStackApiError ? err.message
        : err instanceof Error ? err.message : String(err);
      markFailed(normalized.devEui, msg);
      setError(msg);
      if (audioEnabled) beepError();
    } finally {
      client.close();
      setSubmitting(false);
    }
  }, [active, audioEnabled, markCreated, markFailed, needsSeparateNwkKey, recordSubmission, settings.apiKey, settings.chirpStackUrl]);

  // Shared "populate the form from decoded fields" used by both the QR scan
  // and the OCR capture paths. parseQr's result shape is what both produce
  // — the hex-scan strategy handles raw OCR text just as well as QR text.
  const applyParsedResult = useCallback((parsed: ReturnType<typeof parseQr>, contextLabel: string) => {
    setDevEui(parsed.devEui);
    if (parsed.joinEui) setJoinEui(parsed.joinEui);
    if (parsed.appKey) setAppKey(parsed.appKey);
    setLastScanInfo(
      i18n._('session.scan.context.via', { vendor: parsed.vendor?.name ?? contextLabel, source: parsed.source })
      + (parsed.serialNumber ? ' · ' + i18n._('session.scan.context.sn', { sn: parsed.serialNumber }) : ''),
    );
  }, []);

  // Multi-device mode: add a scanned device to the queue. Dedups by AppKey
  // (the per-device root key — the strongest unique identifier on the label)
  // and verifies the "brand EUI" (JoinEUI) matches the rest of the batch —
  // they should all be the same model. A mismatched scan is rejected with an
  // alert rather than silently provisioned alongside the others.
  const enqueueScan = useCallback((parsed: ReturnType<typeof parseQr>) => {
    if (!isDevEui(parsed.devEui)) {
      setLastScanInfo(i18n._('session.scan.no_decode', { preview: parsed.devEui }));
      return;
    }
    const devEui = parseDevEui(parsed.devEui);
    const joinEui = parsed.joinEui && isJoinEui(parsed.joinEui) ? parseJoinEui(parsed.joinEui) : undefined;
    const appKey = parsed.appKey && isAppKey(parsed.appKey) ? parseAppKey(parsed.appKey) : undefined;
    const cur = queueRef.current;
    // Dedup on AppKey. Only when present — a missing AppKey can't be a match
    // (and such a device fails at bulk-add anyway), so don't collapse them.
    if (appKey && cur.some((d) => d.appKey === appKey)) {
      setLastScanInfo(i18n._('session.multi.scan.duplicate', { devEui }));
      return;
    }
    // The batch's brand EUI is the JoinEUI of the first queued device that had
    // one. A later scan whose JoinEUI differs is a different model — reject it.
    const batchBrand = cur.find((d) => d.joinEui)?.joinEui;
    if (batchBrand && joinEui && joinEui !== batchBrand) {
      setBrandAlert(i18n._('session.multi.brand.mismatch', { got: joinEui, expected: batchBrand }));
      if (scanState.current.audioEnabled) beepError();
      return;
    }
    const item: QueuedDevice = {
      id: String(++queueIdRef.current),
      devEui,
      joinEui,
      appKey,
    };
    setQueue((prev) => [item, ...prev]);
    setBrandAlert(undefined);
    setBulkResult(undefined);
    setLastScanInfo(i18n._('session.multi.scan.added', { devEui }));
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const onScan = useCallback((text: string) => {
    if (scanState.current.audioEnabled) beepScan();
    let parsed;
    try { parsed = parseQr(text); }
    catch {
      const preview = `${text.slice(0, 50)}${text.length > 50 ? '…' : ''}`;
      setLastScanInfo(i18n._('session.scan.no_decode', { preview }));
      return;
    }
    if (scanState.current.multiMode) {
      enqueueScan(parsed);
      return;
    }
    // Single mode: first scan fills the form. A second scan of a *different*
    // device means the operator has a batch — flip to multi mode and seed the
    // queue with both. Identity is the AppKey (the reliably-unique field),
    // falling back to DevEUI when a QR carries no key.
    const identity = (p: ReturnType<typeof parseQr>) => p.appKey ?? p.devEui;
    const prev = singleScanRef.current;
    if (prev && identity(prev) !== identity(parsed)) {
      scanState.current.multiMode = true; // bridge the gap until re-render
      setMultiMode(true);
      setError(undefined);
      enqueueScan(prev);
      enqueueScan(parsed);
      singleScanRef.current = undefined;
      // The first device now lives in the queue — clear the single-entry form.
      setDevEui('');
      setAppKey('');
      setNwkKey('');
      return;
    }
    applyParsedResult(parsed, i18n._('session.scan.context.decoded'));
    singleScanRef.current = parsed;
  }, [applyParsedResult, enqueueScan]);

  // OCR capture: grab the current viewfinder frame, Tesseract → text, then
  // hand off to parseQr. The QR decoder's hex-scan strategy already extracts
  // EUIs / keys from arbitrary token-soup, so we get vendor identification
  // and the same field-population logic for free.
  const onCaptureText = useCallback(async () => {
    if (ocrBusy) return;
    const scanner = scannerRef.current;
    const frame = scanner?.captureFrame();
    if (!frame) {
      setLastScanInfo(i18n._('session.scan.camera_not_ready'));
      return;
    }
    setOcrBusy(true);
    setLastScanInfo(i18n._('session.scan.ocr.reading'));
    setLastOcrText(undefined);
    try {
      const { text, rawText, confidence } = await recognizeText(frame);
      setLastOcrText(rawText);
      let parsed;
      try { parsed = parseQr(text); }
      catch {
        const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 120);
        const preview = trimmed + (trimmed.length === 120 ? '…' : '');
        setLastScanInfo(
          i18n._('session.scan.ocr.no_creds', { confidence: confidence.toFixed(0), preview }),
        );
        // Surface the raw text in console for diagnosis when nothing parses.
        // eslint-disable-next-line no-console
        console.warn('[OCR] no fields extracted. raw text was:\n', rawText);
        if (audioEnabled) beepError();
        return;
      }
      const missing = [
        !parsed.appKey && i18n._('session.scan.field.appKey'),
        !parsed.joinEui && i18n._('session.scan.field.joinEui'),
      ].filter(Boolean) as string[];
      if (missing.length > 0) {
        // Partial parse: show which fields were dropped + the raw OCR text so
        // the operator can see what Tesseract actually read (often hex chars
        // got swapped for similar letters: 0↔O, 1↔I, 8↔B, etc.).
        const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 160);
        const preview = trimmed + (trimmed.length === 160 ? '…' : '');
        setLastScanInfo(
          i18n._('session.scan.ocr.missing', { confidence: confidence.toFixed(0), missing: missing.join(' + '), preview }),
        );
        // eslint-disable-next-line no-console
        console.warn('[OCR] partial parse. parsed:', parsed, '\nraw text:\n', rawText);
      }
      if (audioEnabled) beepScan();
      applyParsedResult(parsed, i18n._('session.scan.context.ocr', { confidence: confidence.toFixed(0) }));
    } catch (err) {
      setLastScanInfo(i18n._('session.scan.ocr.failed', { message: err instanceof Error ? err.message : String(err) }));
      if (audioEnabled) beepError();
    } finally {
      setOcrBusy(false);
    }
  }, [ocrBusy, audioEnabled, applyParsedResult]);

  // Add every queued device to ChirpStack, one at a time. A failure is set
  // aside (kept in the queue, marked failed) and the run continues with the
  // rest, so one bad device can't block the batch. The result summary lists
  // any failures; on a clean run it confirms the whole batch went through.
  const runBulk = useCallback(async () => {
    const items = queueRef.current;
    if (items.length === 0 || bulkRunning || !active) return;
    setBulkRunning(true);
    setBulkResult(undefined);
    setBrandAlert(undefined);
    const client = createChirpStackClient({
      chirpStackUrl: settings.chirpStackUrl,
      apiKey: settings.apiKey,
    });
    const ok: string[] = [];
    const failed: { id: string; error: string }[] = [];
    try {
      // Bottom-up so the on-screen order (newest first) drains naturally.
      for (const item of [...items].reverse()) {
        recordSubmission(item.devEui);
        try {
          if (!item.joinEui) throw new Error(i18n._('session.multi.error.no_joinEui'));
          if (!item.appKey) throw new Error(i18n._('session.multi.error.no_appKey'));
          // QR codes carry a single AppKey; LoRaWAN 1.1.x needs a separate
          // NwkKey that isn't in the code, so those must be added individually.
          if (needsSeparateNwkKey) throw new Error(i18n._('session.multi.error.needs_nwkKey'));
          await client.createDevice({
            devEui: item.devEui,
            name: `${active.modelName} (${item.devEui})`,
            applicationId: active.applicationId,
            deviceProfileId: active.deviceProfileId,
            joinEui: item.joinEui,
            keys: { nwkKey: item.appKey },
          });
          markCreated(item.devEui);
          ok.push(item.devEui);
        } catch (err) {
          const msg = err instanceof ChirpStackApiError ? err.message
            : err instanceof Error ? err.message : String(err);
          markFailed(item.devEui, msg);
          failed.push({ id: item.id, error: msg });
        }
      }
    } finally {
      client.close();
      // Drop the devices that went through; keep failures queued for retry.
      const failedSet = new Set(failed.map((f) => f.id));
      setQueue((prev) => prev.filter((d) => failedSet.has(d.id)));
      setBulkResult({ ok, failed });
      setBulkRunning(false);
      if (audioEnabled) (failed.length === 0 ? beepSuccess : beepError)();
    }
  }, [active, audioEnabled, bulkRunning, markCreated, markFailed, needsSeparateNwkKey, recordSubmission, settings.apiKey, settings.chirpStackUrl]);

  const onEnd = () => setEndDialogOpen(true);
  const onEndConfirmed = () => {
    setEndDialogOpen(false);
    endSession();
    navigate('/');
  };

  const stats = {
    total: submissions.length,
    pending: submissions.filter((s) => s.status === 'pending').length,
    created: submissions.filter((s) => s.status === 'created').length,
    verified: submissions.filter((s) => s.status === 'verified').length,
    failed: submissions.filter((s) => s.status === 'failed').length,
  };

  return (
    <AppShell>
      <Stack spacing={3}>
        {/* Header strip — full width across the page */}
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="overline" color="text.secondary">{t('session.label')}</Typography>
              <Typography variant="h6">{active.modelName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('session.summary', { appName: active.applicationName, profileName: active.deviceProfileName })}
              </Typography>
            </Box>
            <Stack alignItems={{ xs: 'flex-start', sm: 'flex-end' }} spacing={1}>
              <Typography variant="h6" fontFamily="monospace">
                {fmtElapsed(active.startedAt)}
              </Typography>
              <Button size="small" startIcon={<StopIcon />} color="inherit" onClick={onEnd}>
                {t('session.end.button')}
              </Button>
            </Stack>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', gap: 2 }}>
            <StatChip label={t('session.stat.submitted')} value={stats.total} />
            <StatChip label={t('session.stat.inflight')} value={stats.pending} color={stats.pending > 0 ? 'warning' : undefined} />
            <StatChip label={t('session.stat.created')} value={stats.created} color={stats.created > 0 ? 'success' : undefined} />
            {/* Phase 6: re-enable the Verified stat when the verification listener lands. */}
            <StatChip label={t('session.stat.failed')} value={stats.failed} color={stats.failed > 0 ? 'error' : undefined} />
          </Stack>
        </Paper>

        {/*
          Camera + form side-by-side on wide screens (lg+ ≥ 1200 px), stacked
          on narrow. The camera is the primary input — keep it at the focus
          point. The form fields stay one tab away on the right for fallback
          / verification.
        */}
        {/*
          A Grid container offsets its items’ padding with negative margins
          on the container. MUI’s Stack resets the margins of its *direct*
          children (margin: 0 + a directional margin), which wipes those out
          and shoves the whole row right by the spacing. Nesting the Grid one
          level below the Stack keeps its negative margins intact.
        */}
        <Box>
          <Grid container spacing={3} alignItems="stretch">
            <Grid item xs={12} lg={6} sx={{ display: 'flex' }}>
              <Paper sx={{ p: { xs: 2, md: 3 }, width: '100%', display: 'flex', flexDirection: 'column' }}>
                <Stack spacing={2} sx={{ flexGrow: 1 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    spacing={1}
                  >
                    <Typography variant="h6">{t('session.scan.title')}</Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <FormControlLabel
                        control={<Checkbox checked={scannerActive} onChange={(e) => setScannerActive(e.target.checked)} size="small" />}
                        label={t('session.scan.camera')}
                      />
                      <FormControlLabel
                        control={<Checkbox checked={audioEnabled} onChange={(e) => setAudioEnabled(e.target.checked)} size="small" />}
                        label={t('session.scan.sound')}
                      />
                    </Stack>
                  </Stack>

                  <QrScanner
                    ref={scannerRef}
                    onScan={onScan}
                    active={scannerActive && !submitting && !ocrBusy && !bulkRunning}
                  />

                  {/* OCR fallback is single-device only — multi mode is QR-only. */}
                  {!multiMode && (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        variant="outlined"
                        onClick={onCaptureText}
                        disabled={!scannerActive || submitting || ocrBusy}
                        startIcon={ocrBusy ? <CircularProgress size={16} /> : <TextFieldsIcon />}
                      >
                        {ocrBusy ? t('session.scan.read_text.reading') : t('session.scan.read_text.button')}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        {t('session.scan.read_text.helper')}
                      </Typography>
                    </Stack>
                  )}

                  {lastScanInfo && (
                    <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
                      {lastScanInfo}
                    </Alert>
                  )}
                </Stack>
              </Paper>
            </Grid>

            <Grid item xs={12} lg={6} sx={{ display: 'flex' }}>
              <Paper sx={{ p: { xs: 2, md: 3 }, width: '100%', display: 'flex', flexDirection: 'column' }}>
                <Stack spacing={2.5} sx={{ flexGrow: 1 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    spacing={1}
                  >
                    <Typography variant="h6">{t('session.form.title')}</Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={multiMode}
                          onChange={(e) => {
                            setMultiMode(e.target.checked);
                            setBrandAlert(undefined);
                            setBulkResult(undefined);
                            setError(undefined);
                            singleScanRef.current = undefined;
                          }}
                          size="small"
                          disabled={bulkRunning}
                        />
                      }
                      label={t('session.multi.checkbox')}
                    />
                  </Stack>

                  {!multiMode ? (
                    <>
                      <TextField
                        inputRef={devEuiRef}
                        label={t('session.form.devEui.label')}
                        value={devEui}
                        onChange={(e) => setDevEui(e.target.value)}
                        error={!devEuiValid}
                        helperText={!devEuiValid ? t('session.form.devEui.error') : ' '}
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <TextField
                        label={t('session.form.joinEui.label')}
                        value={joinEui}
                        onChange={(e) => setJoinEui(e.target.value)}
                        error={!joinEuiValid}
                        helperText={!joinEuiValid ? t('session.form.joinEui.error') : t('session.form.joinEui.helper')}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <TextField
                        label={needsSeparateNwkKey ? t('session.form.appKey.label.split') : t('session.form.appKey.label')}
                        value={appKey}
                        onChange={(e) => setAppKey(e.target.value)}
                        error={!appKeyValid}
                        helperText={!appKeyValid ? t('session.form.appKey.error') : ' '}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {needsSeparateNwkKey && (
                        <TextField
                          label={t('session.form.nwkKey.label')}
                          type={showKey ? 'text' : 'password'}
                          value={nwkKey}
                          onChange={(e) => setNwkKey(e.target.value)}
                          error={!nwkKeyValid}
                          helperText={!nwkKeyValid ? t('session.form.nwkKey.error') : t('session.form.nwkKey.helper')}
                          autoComplete="off"
                          spellCheck={false}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton onClick={() => setShowKey((s) => !s)} edge="end" size="small">
                                  {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                </IconButton>
                              </InputAdornment>
                            ),
                          }}
                        />
                      )}
                      {error && <Alert severity="error">{error}</Alert>}
                    </>
                  ) : (
                    <DeviceQueue
                      queue={queue}
                      brandEui={queue.find((d) => d.joinEui)?.joinEui}
                      failed={bulkResult?.failed ?? []}
                      busy={bulkRunning}
                      onRemove={removeFromQueue}
                    />
                  )}

                  {multiMode && brandAlert && (
                    <Alert severity="warning" onClose={() => setBrandAlert(undefined)}>
                      {brandAlert}
                    </Alert>
                  )}

                  {multiMode && bulkResult && (
                    <Alert severity={bulkResult.failed.length === 0 ? 'success' : 'warning'}>
                      {bulkResult.failed.length === 0
                        ? t('session.multi.result.success', { count: bulkResult.ok.length })
                        : t('session.multi.result.partial', { ok: bulkResult.ok.length, failed: bulkResult.failed.length })}
                    </Alert>
                  )}

                  <Stack direction="row" spacing={2} justifyContent="flex-end">
                    {multiMode ? (
                      <Button
                        variant="contained"
                        onClick={() => runBulk()}
                        disabled={queue.length === 0 || bulkRunning}
                        startIcon={bulkRunning ? <CircularProgress size={16} /> : undefined}
                      >
                        {bulkRunning ? t('session.multi.submit.working') : t('session.multi.submit.button')}
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        onClick={() => submit()}
                        disabled={!canSubmit}
                        startIcon={submitting ? <CircularProgress size={16} /> : undefined}
                      >
                        {submitting ? t('session.form.submit.working') : t('session.form.submit.button')}
                      </Button>
                    )}
                  </Stack>

                  {!multiMode && lastOcrText && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {t('session.ocr.raw_text')}
                      </Typography>
                      <Box
                        component="pre"
                        sx={{
                          m: 0,
                          p: 1.5,
                          backgroundColor: 'action.hover',
                          borderRadius: 1,
                          fontFamily: 'monospace',
                          fontSize: '0.8125rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          maxHeight: 200,
                          overflow: 'auto',
                        }}
                      >
                        {lastOcrText}
                      </Box>
                    </Box>
                  )}
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </Box>

        {submissions.length > 0 && (
          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">{t('session.recent.title')}</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('session.recent.devEui')}</TableCell>
                      <TableCell>{t('session.recent.status')}</TableCell>
                      <TableCell align="right">{t('session.recent.submitted')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {submissions.slice(0, 50).map((sub) => (
                      <SubmissionRow key={sub.devEui} sub={sub} />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          </Paper>
        )}
      </Stack>

      <Dialog open={endDialogOpen} onClose={() => setEndDialogOpen(false)}>
        <DialogTitle>{t('session.end.dialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('session.end.dialog.body')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEndDialogOpen(false)}>{t('session.end.dialog.cancel')}</Button>
          <Button onClick={onEndConfirmed} color="error" variant="contained">{t('session.end.dialog.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}

/**
 * The multi-device scan queue: the brand EUI locked for the batch, a count,
 * and each scanned device with a remove control. Devices that failed the most
 * recent bulk add are flagged inline with their error so the operator can fix
 * or drop them before retrying.
 */
function DeviceQueue({ queue, brandEui, failed, busy, onRemove }: {
  queue: QueuedDevice[];
  brandEui?: string;
  failed: { id: string; error: string }[];
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const failedMap = new Map(failed.map((f) => [f.id, f.error]));
  return (
    <Box sx={{ flexGrow: 1 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {t('session.multi.queue.count', { count: queue.length })}
        </Typography>
        {brandEui && (
          <Typography variant="caption" color="text.secondary" fontFamily="monospace" sx={{ wordBreak: 'break-all', textAlign: 'right' }}>
            {t('session.multi.queue.brand', { joinEui: brandEui })}
          </Typography>
        )}
      </Stack>
      {queue.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('session.multi.queue.empty')}
        </Typography>
      ) : (
        <Stack divider={<Divider />}>
          {queue.map((d) => {
            const err = failedMap.get(d.id);
            return (
              <Stack key={d.id} direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ py: 0.75 }}>
                <Box sx={{ minWidth: 0 }}>
                  {d.appKey ? (
                    <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                      {d.appKey}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="warning.main">
                      {t('session.multi.error.no_appKey')}
                    </Typography>
                  )}
                  {err && (
                    <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                      {err}
                    </Typography>
                  )}
                </Box>
                <IconButton size="small" onClick={() => onRemove(d.id)} disabled={busy} aria-label={t('session.multi.queue.remove')}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

function StatChip({ label, value, color }: { label: string; value: number; color?: 'success' | 'error' | 'warning' | 'info' }) {
  return (
    <Stack alignItems="center" spacing={0}>
      <Typography variant="h5" color={color ? `${color}.main` : 'text.primary'}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

function SubmissionRow({ sub }: { sub: Submission }) {
  return (
    <TableRow>
      <TableCell><code>{sub.devEui}</code></TableCell>
      <TableCell>
        <StatusChip status={sub.status} error={sub.error} />
      </TableCell>
      <TableCell align="right">
        <Typography variant="body2" color="text.secondary">
          {new Date(sub.submittedAt).toLocaleTimeString()}
        </Typography>
      </TableCell>
    </TableRow>
  );
}

function StatusChip({ status, error }: { status: SubmissionStatus; error?: string }) {
  const t = useT();
  switch (status) {
    case 'pending':
      return <Chip size="small" label={t('session.status.pending')} icon={<HourglassEmptyIcon fontSize="inherit" />} />;
    case 'created':
      return <Chip size="small" label={t('session.status.created')} color="info" icon={<CheckCircleIcon fontSize="inherit" />} variant="outlined" />;
    case 'verified':
      return <Chip size="small" label={t('session.status.verified')} color="success" icon={<CheckCircleIcon fontSize="inherit" />} />;
    case 'failed':
      return <Chip size="small" label={t('session.status.failed')} color="error" icon={<ErrorIcon fontSize="inherit" />} title={error} />;
    default:
      return <Chip size="small" label={status} icon={<RadioButtonUncheckedIcon fontSize="inherit" />} />;
  }
}
