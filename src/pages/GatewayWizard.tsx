import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, InputLabel,
  MenuItem, Paper, Select, Stack, Step, StepLabel, Stepper, TextField, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';

import { AppShell } from '../components/AppShell';
import { QrScanner } from '../components/QrScanner';
import { CodeBlock } from '../components/CodeBlock';
import { MarkdownView } from '../components/MarkdownView';
import { useSettings } from '../state/settings';
import { i18n, useT } from '../i18n';
import {
  createChirpStackClient,
  ChirpStackApiError,
  type GatewaySummary,
} from '../lib/chirpstack-api';
import {
  catalogRegions,
  detectGatewayCandidates,
  gatewayCatalog,
  gatewayInfo,
  gatewayWalkthrough,
  renderGatewayConfig,
} from '../lib/gateway-catalog';
import type { PacketForwarder } from '@intelligent-farming/lorawan-gateway-catalog';

const EUI16 = /^[0-9A-Fa-f]{16}$/;
const normHex = (s: string) => s.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

/** Best-effort host extraction from the ChirpStack REST URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * Default Gateway Bridge host — the host a gateway forwards LoRaWAN packets to.
 *
 * Precedence:
 *   1. `saved` — settings.gatewayBridgeHost: the operator's value, or the host's
 *      real LAN IP resolved server-side by docker-entrypoint.sh and hydrated from
 *      /config.json. This is the authoritative source; the browser cannot see the
 *      host's actual inet.
 *   2. `window.location.hostname` — how the browser reached Leftenant; a decent
 *      guess for a static/dev host, but only if it's not localhost.
 *   3. the ChirpStack URL host, then localhost as a last resort (dev).
 */
function detectBridgeHost(saved: string | undefined, chirpStackUrl: string): string {
  if (saved) return saved;
  const loc = typeof window !== 'undefined' ? window.location.hostname : '';
  if (!LOCAL_HOSTS.has(loc)) return loc;
  const cs = hostOf(chirpStackUrl);
  if (!LOCAL_HOSTS.has(cs)) return cs;
  return loc || cs || 'localhost';
}

const fmtAgo = (d: Date): string => {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return i18n._('session.monitor.ago.seconds', { s });
  if (s < 3600) return i18n._('session.monitor.ago.minutes', { m: Math.round(s / 60) });
  return i18n._('session.monitor.ago.hours', { h: Math.round(s / 3600) });
};

export function GatewayWizardPage() {
  const settings = useSettings();
  const setSettings = useSettings((s) => s.setSettings);
  const navigate = useNavigate();
  const t = useT();

  const [step, setStep] = useState(0);

  // --- identify ---
  const [eui, setEui] = useState('');
  const [scanning, setScanning] = useState(false);
  const [vendor, setVendor] = useState('');
  const [model, setModel] = useState('');
  const [region, setRegion] = useState('');
  const [forwarder, setForwarder] = useState<PacketForwarder | ''>('');

  const euiHex = normHex(eui);
  const euiValid = EUI16.test(euiHex);

  const detection = useMemo(() => detectGatewayCandidates(euiHex), [euiHex]);

  // Candidate models: those matching the scanned OUI, else the whole catalog.
  const candidates = useMemo(() => {
    if (detection.candidates.length > 0) return detection.candidates;
    return gatewayCatalog().map((g) => ({ vendor: g.vendor, model: g.model, name: g.name }));
  }, [detection]);

  const info = vendor && model ? gatewayInfo(vendor, model) : null;

  // When candidates narrow to exactly one (OUI hit + single model), preselect it.
  useEffect(() => {
    if (detection.candidates.length === 1) {
      const c = detection.candidates[0];
      setVendor(c.vendor);
      setModel(c.model);
    }
  }, [detection]);

  // Default region/forwarder when a model is chosen. Region defaults to US915
  // (the stack's band) when the model supports it, else its first region.
  useEffect(() => {
    if (!info) return;
    setRegion((r) => {
      if (info.regions.includes(r)) return r;
      if (info.regions.includes('US915')) return 'US915';
      return info.regions[0] ?? '';
    });
    setForwarder((f) => (f && info.packetForwarders.includes(f as PacketForwarder) ? f : info.packetForwarders[0] ?? ''));
  }, [info]);

  const onModelChange = (value: string) => {
    const [v, m] = value.split('/');
    setVendor(v);
    setModel(m);
  };

  // --- configure ---
  const [bridgeHost, setBridgeHost] = useState(() =>
    detectBridgeHost(settings.gatewayBridgeHost, settings.chirpStackUrl),
  );
  const [copied, setCopied] = useState(false);

  const rendered = useMemo(() => {
    if (!info || !forwarder || !region || !euiValid || !bridgeHost) {
      return { text: '', error: '' };
    }
    try {
      const text = renderGatewayConfig(vendor, model, {
        forwarder: forwarder as PacketForwarder,
        region,
        connection: { serverAddress: bridgeHost, gatewayEui: euiHex },
      });
      return { text, error: '' };
    } catch (e) {
      return { text: '', error: e instanceof Error ? e.message : String(e) };
    }
  }, [info, vendor, model, forwarder, region, euiHex, euiValid, bridgeHost]);

  const walkthrough = info ? gatewayWalkthrough(vendor, model) : null;

  // Connection settings the operator types into the gateway's form. Most vendor
  // web UIs are a form (Server Address / ports), not a JSON paste box — so these
  // values, not the raw config file, are what most setups actually need.
  const regionMeta = catalogRegions().find((r) => r.id === region);
  const subBandSuffix = regionMeta?.defaultSubBand
    ? ` · ${t('gateway.summary.subband', { n: regionMeta.defaultSubBand })}`
    : '';
  const summaryRows: Array<[string, string]> =
    forwarder === 'basics-station'
      ? [
          [t('gateway.summary.tcuri'), bridgeHost ? `wss://${bridgeHost}:3001` : ''],
          [t('gateway.summary.eui'), euiHex],
          [t('gateway.summary.region'), region ? `${region}${subBandSuffix}` : ''],
        ]
      : [
          [t('gateway.summary.host'), bridgeHost],
          [t('gateway.summary.ports'), '1700 / 1700'],
          [t('gateway.summary.eui'), euiHex],
          [t('gateway.summary.region'), region ? `${region}${subBandSuffix}` : ''],
        ];

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(rendered.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the operator can select the text */
    }
  };

  // --- register ---
  const [gatewayName, setGatewayName] = useState('');
  useEffect(() => {
    if (info && !gatewayName) setGatewayName(`${info.name} ${euiHex.slice(-4)}`.trim());
  }, [info, euiHex, gatewayName]);

  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registered, setRegistered] = useState(false);

  const register = async () => {
    if (!settings.tenantId) {
      setRegisterError('No tenant selected — run the connection setup first.');
      return;
    }
    setRegistering(true);
    setRegisterError('');
    const client = createChirpStackClient({ chirpStackUrl: settings.chirpStackUrl, apiKey: settings.apiKey });
    try {
      await client.createGateway({
        gatewayId: euiHex,
        name: gatewayName || `gateway-${euiHex}`,
        tenantId: settings.tenantId,
        description: info ? `${info.name} — added via Leftenant` : '',
      });
      setRegistered(true);
      setStep(3);
    } catch (e) {
      if (e instanceof ChirpStackApiError && (e.code === 409 || /exist/i.test(e.message))) {
        // Already present — treat as success so the operator can still verify it.
        setRegistered(true);
        setRegisterError(t('gateway.register.exists'));
        setStep(3);
      } else {
        setRegisterError(t('gateway.register.error', { msg: e instanceof Error ? e.message : String(e) }));
      }
    } finally {
      client.close();
      setRegistering(false);
    }
  };

  // --- verify (poll lastSeenAt) ---
  const [gwStatus, setGwStatus] = useState<GatewaySummary | null>(null);
  const [, forceTick] = useState(0);
  const chirpUrl = settings.chirpStackUrl;
  const apiKey = settings.apiKey;
  const pollingEuiRef = useRef(euiHex);
  pollingEuiRef.current = euiHex;

  useEffect(() => {
    if (step !== 3 || !registered) return undefined;
    let cancelled = false;
    const poll = async () => {
      const client = createChirpStackClient({ chirpStackUrl: chirpUrl, apiKey });
      try {
        const gw = await client.getGateway(pollingEuiRef.current);
        if (!cancelled) setGwStatus(gw);
      } catch {
        /* transient — keep polling */
      } finally {
        client.close();
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 4000);
    // Re-render for the relative "last seen" label even between polls.
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => { cancelled = true; clearInterval(id); clearInterval(tick); };
  }, [step, registered, chirpUrl, apiKey]);

  const online = !!gwStatus?.lastSeenAt;

  const steps = [
    t('gateway.step.identify'),
    t('gateway.step.configure'),
    t('gateway.step.apply'),
    t('gateway.step.verify'),
  ];

  const canLeaveIdentify = euiValid && !!info && !!region && !!forwarder;
  const canLeaveConfigure = !!rendered.text && !rendered.error && !!bridgeHost;

  return (
    <AppShell>
      <Stack spacing={3}>
        <Typography variant="h5">{t('gateway.title')}</Typography>
        <Stepper activeStep={step} alternativeLabel>
          {steps.map((label) => (
            <Step key={label}><StepLabel>{label}</StepLabel></Step>
          ))}
        </Stepper>

        {/* Step 0 — identify */}
        {step === 0 && (
          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
                <TextField
                  label={t('gateway.eui.label')}
                  value={eui}
                  onChange={(e) => setEui(e.target.value)}
                  helperText={euiValid ? ' ' : t('gateway.eui.helper')}
                  error={eui.length > 0 && !euiValid}
                  fullWidth
                  inputProps={{ style: { fontFamily: 'monospace' } }}
                />
                <Button
                  variant={scanning ? 'contained' : 'outlined'}
                  onClick={() => setScanning((v) => !v)}
                  startIcon={<QrCodeScannerIcon />}
                  sx={{ mt: 1, flexShrink: 0 }}
                >
                  {scanning ? t('gateway.eui.stop') : t('gateway.eui.scan')}
                </Button>
              </Stack>

              {scanning && (
                <Box sx={{ maxWidth: 420 }}>
                  <QrScanner
                    active={scanning}
                    onScan={(text) => {
                      const hex = normHex(text);
                      setEui(hex.length >= 16 ? hex.slice(0, 16) : hex);
                      setScanning(false);
                    }}
                  />
                </Box>
              )}

              {euiValid && (
                detection.vendor ? (
                  <Chip
                    color="success"
                    variant="outlined"
                    icon={<CheckCircleIcon />}
                    label={t('gateway.detect.vendor', { vendor: detection.ouiName || detection.vendor })}
                    sx={{ alignSelf: 'flex-start' }}
                  />
                ) : (
                  <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
                    {t('gateway.detect.none')}
                  </Alert>
                )
              )}

              <FormControl fullWidth disabled={!euiValid}>
                <InputLabel>{t('gateway.model.label')}</InputLabel>
                <Select
                  label={t('gateway.model.label')}
                  value={vendor && model ? `${vendor}/${model}` : ''}
                  onChange={(e) => onModelChange(e.target.value)}
                >
                  {candidates.map((c) => (
                    <MenuItem key={`${c.vendor}/${c.model}`} value={`${c.vendor}/${c.model}`}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl fullWidth disabled={!info}>
                  <InputLabel>{t('gateway.region.label')}</InputLabel>
                  <Select label={t('gateway.region.label')} value={region} onChange={(e) => setRegion(e.target.value)}>
                    {(info?.regions ?? []).map((r) => (
                      <MenuItem key={r} value={r}>{r}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth disabled={!info}>
                  <InputLabel>{t('gateway.forwarder.label')}</InputLabel>
                  <Select
                    label={t('gateway.forwarder.label')}
                    value={forwarder}
                    onChange={(e) => setForwarder(e.target.value as PacketForwarder)}
                  >
                    {(info?.packetForwarders ?? []).map((f) => (
                      <MenuItem key={f} value={f}>{f}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <Box>
                <Button variant="contained" disabled={!canLeaveIdentify} onClick={() => setStep(1)}>
                  {t('gateway.next')}
                </Button>
              </Box>
            </Stack>
          </Paper>
        )}

        {/* Step 1 — configure */}
        {step === 1 && (
          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
              <TextField
                label={t('gateway.bridge.label')}
                value={bridgeHost}
                onChange={(e) => { setBridgeHost(e.target.value); setSettings({ gatewayBridgeHost: e.target.value }); }}
                helperText={t('gateway.bridge.helper')}
                fullWidth
              />

              {/* What to type into the gateway's form (most web UIs are a form). */}
              <Box>
                <Typography variant="subtitle1">{t('gateway.summary.title')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('gateway.summary.subtitle')}
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'max-content 1fr',
                    columnGap: 2,
                    rowGap: 0.75,
                    p: 2,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                  }}
                >
                  {summaryRows.map(([label, value]) => (
                    <Fragment key={label}>
                      <Typography variant="body2" color="text.secondary">{label}</Typography>
                      <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
                        {value || '—'}
                      </Box>
                    </Fragment>
                  ))}
                </Box>
              </Box>

              {rendered.error ? (
                <Alert severity="error" variant="outlined">
                  {t('gateway.config.error', { msg: rendered.error })}
                </Alert>
              ) : (
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle1">{t('gateway.config.fileTitle')}</Typography>
                    <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyConfig}>
                      {copied ? t('gateway.config.copied') : t('gateway.config.copy')}
                    </Button>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('gateway.config.fileHint')}
                  </Typography>
                  <CodeBlock
                    value={rendered.text}
                    language={forwarder === 'basics-station' ? 'json5' : 'json'}
                  />
                </Box>
              )}

              {walkthrough && (
                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('gateway.walkthrough.title')}</Typography>
                  <MarkdownView source={walkthrough} />
                </Box>
              )}

              <Stack direction="row" spacing={2}>
                <Button onClick={() => setStep(0)}>{t('gateway.back')}</Button>
                <Button variant="contained" disabled={!canLeaveConfigure} onClick={() => setStep(2)}>
                  {t('gateway.next')}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}

        {/* Step 2 — apply & register */}
        {step === 2 && (
          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
              <Typography variant="subtitle1">{t('gateway.register.title')}</Typography>
              <Alert severity="info" variant="outlined">{t('gateway.verify.hint')}</Alert>
              <TextField
                label={t('gateway.register.name.label')}
                value={gatewayName}
                onChange={(e) => setGatewayName(e.target.value)}
                fullWidth
              />
              {registerError && <Alert severity="warning" variant="outlined">{registerError}</Alert>}
              <Stack direction="row" spacing={2} alignItems="center">
                <Button onClick={() => setStep(1)} disabled={registering}>{t('gateway.back')}</Button>
                <Button variant="contained" onClick={register} disabled={registering}>
                  {registering ? <CircularProgress size={20} /> : t('gateway.register.button')}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}

        {/* Step 3 — verify */}
        {step === 3 && (
          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
              <Typography variant="subtitle1">{t('gateway.verify.title')}</Typography>
              {registered && !registerError && (
                <Alert severity="success" variant="outlined">{t('gateway.register.success')}</Alert>
              )}
              <Stack direction="row" spacing={2} alignItems="center">
                {online ? (
                  <Chip color="success" icon={<CheckCircleIcon />}
                    label={t('gateway.verify.online', { ago: gwStatus?.lastSeenAt ? fmtAgo(gwStatus.lastSeenAt) : '' })} />
                ) : (
                  <>
                    <CircularProgress size={18} />
                    <Typography color="text.secondary">{t('gateway.verify.waiting')}</Typography>
                  </>
                )}
              </Stack>
              {!online && <Alert severity="info" variant="outlined">{t('gateway.verify.hint')}</Alert>}
              <Box>
                <Button variant="contained" onClick={() => navigate('/')}>{t('gateway.done')}</Button>
              </Box>
            </Stack>
          </Paper>
        )}
      </Stack>
    </AppShell>
  );
}
