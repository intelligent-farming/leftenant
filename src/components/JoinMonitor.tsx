import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Chip, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';

import { createChirpStackClient, listAllDevices } from '../lib/chirpstack-api';
import { useSession } from '../state/session';
import { useSettings } from '../state/settings';
import { i18n, useT } from '../i18n';

/** How often to ask ChirpStack whether the session's devices have been heard. */
const POLL_MS = 4000;

const fmtAgo = (d: Date): string => {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return i18n._('session.monitor.ago.seconds', { s });
  if (s < 3600) return i18n._('session.monitor.ago.minutes', { m: Math.round(s / 60) });
  return i18n._('session.monitor.ago.hours', { h: Math.round(s / 3600) });
};

/**
 * Watches the session's provisioned devices for their first contact with the
 * network. ChirpStack sets a device's `lastSeenAt` the moment it hears that
 * device after an OTAA join, so we poll the REST API (the same gateway used to
 * create the devices) and flip each row from "Waiting" to "Joined" — promoting
 * the submission to `verified`, which also drives the header's Verified stat.
 *
 * No MQTT: REST polling reuses the working API key, needs no broker exposure,
 * and covers exactly what we need here ("has this device joined yet?").
 */
export function JoinMonitor() {
  const settings = useSettings();
  const submissions = useSession((s) => s.submissions);
  const markVerified = useSession((s) => s.markVerified);
  const active = useSession((s) => s.active);
  const t = useT();

  const [seen, setSeen] = useState<Map<string, Date>>(new Map());
  const [error, setError] = useState<string | undefined>();

  // Let the poll read the live submission list without re-arming the interval.
  const submissionsRef = useRef(submissions);
  submissionsRef.current = submissions;

  const applicationId = active?.applicationId;
  const { chirpStackUrl, apiKey } = settings;

  useEffect(() => {
    if (!applicationId) return undefined;
    let cancelled = false;
    const poll = async () => {
      const client = createChirpStackClient({ chirpStackUrl, apiKey });
      try {
        const devices = await listAllDevices(client, applicationId);
        if (cancelled) return;
        const map = new Map<string, Date>();
        for (const d of devices) if (d.lastSeenAt) map.set(d.devEui.toUpperCase(), d.lastSeenAt);
        setSeen(map);
        setError(undefined);
        // A provisioned device that ChirpStack has now heard has joined.
        for (const s of submissionsRef.current) {
          if (s.status === 'created' && map.has(s.devEui.toUpperCase())) markVerified(s.devEui);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        client.close();
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [applicationId, chirpStackUrl, apiKey, markVerified]);

  const monitored = submissions.filter((s) => s.status === 'created' || s.status === 'verified');
  const joinedCount = monitored.filter((s) => s.status === 'verified').length;

  return (
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
          <Box>
            <Typography variant="h6">{t('session.monitor.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('session.monitor.summary', { joined: joinedCount, total: monitored.length })}
            </Typography>
          </Box>
          <Chip
            size="small"
            icon={<RadioButtonCheckedIcon fontSize="small" />}
            label={t('session.monitor.live')}
            color={error ? 'default' : 'success'}
            variant={error ? 'outlined' : 'filled'}
          />
        </Stack>

        {error && (
          <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>{error}</Alert>
        )}

        <TableContainer sx={{ maxHeight: 320 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('session.recent.devEui')}</TableCell>
                <TableCell>{t('session.recent.status')}</TableCell>
                <TableCell>{t('session.monitor.lastSeen')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {monitored.map((s) => {
                const at = seen.get(s.devEui.toUpperCase()) ?? (s.verifiedAt ? new Date(s.verifiedAt) : undefined);
                return (
                  <TableRow key={s.devEui}>
                    <TableCell><code>{s.devEui}</code></TableCell>
                    <TableCell>
                      {s.status === 'verified' ? (
                        <Chip size="small" color="success" icon={<CheckCircleIcon fontSize="inherit" />} label={t('session.monitor.status.joined')} />
                      ) : (
                        <Chip size="small" variant="outlined" icon={<HourglassEmptyIcon fontSize="inherit" />} label={t('session.monitor.status.waiting')} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {at ? fmtAgo(at) : '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </Paper>
  );
}
