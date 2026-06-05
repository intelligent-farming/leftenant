import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, IconButton, InputAdornment,
  Paper, Stack, TextField, Typography,
} from '@mui/material';
import { AppShell } from '../components/AppShell';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

import { useSettings, type ConnectionSettings } from '../state/settings';
import { probeConnection, ChirpStackApiError } from '../lib/chirpstack-api';
import { useT } from '../i18n';
import logoFull from '../assets/leftenant-logo-full.png';

// ChirpStack v4's default tenant has a well-known UUID. Used as the fallback
// when the operator hasn't picked one yet.
const DEFAULT_TENANT_ID = '52f14cd4-c6f1-4fbd-8f87-4025e1d49242';

/**
 * Return true if `s` parses as a URL whose protocol is in the allow-list.
 * Used both by the Save guard (so the user can't persist garbage and only
 * discover it on the next page) and by the per-field inline error helper.
 */
const isValidUrl = (s: string, protocols: string[]): boolean => {
  try { return protocols.includes(new URL(s).protocol); }
  catch { return false; }
};

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

interface TestResult {
  status: TestStatus;
  message?: string;
}

export function SettingsPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const t = useT();

  // Local draft state — only commit to the persistent store on Save.
  const [draft, setDraft] = useState<ConnectionSettings>({
    chirpStackUrl: settings.chirpStackUrl,
    apiKey: settings.apiKey,
    mqttUrl: settings.mqttUrl,
    mqttUsername: settings.mqttUsername ?? '',
    mqttPassword: settings.mqttPassword ?? '',
    tenantId: settings.tenantId ?? DEFAULT_TENANT_ID,
    configured: settings.configured,
  });
  const [showKey, setShowKey] = useState(false);
  const [grpcTest, setGrpcTest] = useState<TestResult>({ status: 'idle' });
  const [mqttTest, setMqttTest] = useState<TestResult>({ status: 'idle' });

  const update = (patch: Partial<ConnectionSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const onTest = async () => {
    setGrpcTest({ status: 'testing' });
    setMqttTest({ status: 'testing' });

    // ChirpStack — actually call listApplications via gRPC-Web.
    try {
      new URL(draft.chirpStackUrl);
      const { applicationCount } = await probeConnection(
        { chirpStackUrl: draft.chirpStackUrl, apiKey: draft.apiKey },
        draft.tenantId ?? DEFAULT_TENANT_ID,
      );
      setGrpcTest({
        status: 'ok',
        message: t('settings.test.chirpstack.connected', { count: applicationCount }),
      });
    } catch (err) {
      const msg = err instanceof ChirpStackApiError
        ? t('settings.test.chirpstack.error', { message: err.message })
        : err instanceof Error
          ? err.message
          : t('settings.test.chirpstack.connection_failed');
      setGrpcTest({ status: 'error', message: msg });
    }

    // MQTT — still a URL-shape check; live connect happens on the Home
    // screen's join-feed widget, which has clearer error UX for the longer
    // connect handshake.
    try {
      const u = new URL(draft.mqttUrl);
      if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
        throw new Error(t('settings.test.mqtt.invalid_protocol'));
      }
      setMqttTest({ status: 'ok', message: t('settings.test.mqtt.ok') });
    } catch (err) {
      setMqttTest({ status: 'error', message: err instanceof Error ? err.message : t('settings.test.mqtt.invalid') });
    }
  };

  const onSave = () => {
    settings.setSettings({ ...draft, configured: true });
    navigate('/');
  };

  const chirpStackUrlValid = isValidUrl(draft.chirpStackUrl, ['http:', 'https:']);
  const mqttUrlValid = isValidUrl(draft.mqttUrl, ['ws:', 'wss:']);
  // Show inline errors only after the user has typed something — empty is the
  // initial state, not a validation failure.
  const chirpStackUrlError = draft.chirpStackUrl.length > 0 && !chirpStackUrlValid;
  const mqttUrlError = draft.mqttUrl.length > 0 && !mqttUrlValid;
  const canSave = chirpStackUrlValid && draft.apiKey.length > 0 && mqttUrlValid;

  return (
    <AppShell maxWidth="sm">
      <Stack spacing={3}>
        <Box sx={{ textAlign: 'center' }}>
          <Box
            component="img"
            src={logoFull}
            alt="Leftenant"
            sx={{
              width: '100%',
              maxWidth: 280,
              height: 'auto',
              display: 'block',
              mx: 'auto',
              mb: 2,
            }}
          />
          <Typography variant="body1" color="text.secondary">
            {t('settings.intro')}
          </Typography>
        </Box>

        <Paper sx={{ p: 3 }}>
          <Stack spacing={2.5}>
            <Typography variant="h6">{t('settings.chirpstack.section')}</Typography>
            <TextField
              label={t('settings.chirpstack.url.label')}
              placeholder="http://chirpstack.local:8090"
              value={draft.chirpStackUrl}
              onChange={(e) => update({ chirpStackUrl: e.target.value })}
              error={chirpStackUrlError}
              helperText={chirpStackUrlError
                ? t('settings.chirpstack.url.error')
                : t('settings.chirpstack.url.helper')}
            />
            <TextField
              label={t('settings.chirpstack.apikey.label')}
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              helperText={t('settings.chirpstack.apikey.helper')}
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
            <TextField
              label={t('settings.chirpstack.tenant.label')}
              value={draft.tenantId ?? ''}
              onChange={(e) => update({ tenantId: e.target.value })}
              helperText={t('settings.chirpstack.tenant.helper')}
              spellCheck={false}
              autoComplete="off"
            />
            <TestStatusRow label="ChirpStack" result={grpcTest} />
          </Stack>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Stack spacing={2.5}>
            <Typography variant="h6">{t('settings.mqtt.section')}</Typography>
            <TextField
              label={t('settings.mqtt.url.label')}
              placeholder="ws://chirpstack.local:9001"
              value={draft.mqttUrl}
              onChange={(e) => update({ mqttUrl: e.target.value })}
              error={mqttUrlError}
              helperText={mqttUrlError
                ? t('settings.mqtt.url.error')
                : t('settings.mqtt.url.helper')}
            />
            <TextField
              label={t('settings.mqtt.username.label')}
              value={draft.mqttUsername ?? ''}
              onChange={(e) => update({ mqttUsername: e.target.value })}
            />
            <TextField
              label={t('settings.mqtt.password.label')}
              type="password"
              value={draft.mqttPassword ?? ''}
              onChange={(e) => update({ mqttPassword: e.target.value })}
            />
            <TestStatusRow label="MQTT" result={mqttTest} />
          </Stack>
        </Paper>

        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button onClick={onTest} variant="outlined">
            {t('settings.test.button')}
          </Button>
          <Button onClick={onSave} variant="contained" disabled={!canSave}>
            {t('settings.save.button')}
          </Button>
        </Stack>
      </Stack>
    </AppShell>
  );
}

function TestStatusRow({ label, result }: { label: string; result: TestResult }) {
  const t = useT();
  if (result.status === 'idle') return null;
  if (result.status === 'testing') {
    return <Alert severity="info">{t('settings.test.testing', { label })}</Alert>;
  }
  if (result.status === 'ok') {
    return (
      <Alert severity="success" icon={<CheckCircleIcon fontSize="inherit" />}>
        {label}: {result.message ?? t('settings.test.ok.default')}
      </Alert>
    );
  }
  return (
    <Alert severity="error" icon={<ErrorIcon fontSize="inherit" />}>
      {label}: {result.message ?? t('settings.test.error.default')}
    </Alert>
  );
}
