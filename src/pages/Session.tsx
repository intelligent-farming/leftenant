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

  const onScan = useCallback((text: string) => {
    if (audioEnabled) beepScan();
    let parsed;
    try { parsed = parseQr(text); }
    catch {
      const preview = `${text.slice(0, 50)}${text.length > 50 ? '…' : ''}`;
      setLastScanInfo(i18n._('session.scan.no_decode', { preview }));
      return;
    }
    applyParsedResult(parsed, i18n._('session.scan.context.decoded'));
  }, [audioEnabled, applyParsedResult]);

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
                  active={scannerActive && !submitting && !ocrBusy}
                />

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
                <Typography variant="h6">{t('session.form.title')}</Typography>
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
              type={showKey ? 'text' : 'password'}
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              error={!appKeyValid}
              helperText={!appKeyValid ? t('session.form.appKey.error') : ' '}
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
              />
            )}

                {error && <Alert severity="error">{error}</Alert>}

                <Stack direction="row" spacing={2} justifyContent="flex-end">
                  <Button
                    variant="contained"
                    onClick={() => submit()}
                    disabled={!canSubmit}
                    startIcon={submitting ? <CircularProgress size={16} /> : undefined}
                  >
                    {submitting ? t('session.form.submit.working') : t('session.form.submit.button')}
                  </Button>
                </Stack>

                {lastOcrText && (
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
