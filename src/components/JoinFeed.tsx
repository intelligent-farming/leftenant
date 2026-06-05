import {
  Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import { useJoinFeed } from '../hooks/useJoinFeed';
import { i18n, useT, type MessageKey } from '../i18n';

const STATUS_KEYS: Record<string, MessageKey> = {
  connecting: 'joinfeed.status.connecting',
  connected: 'joinfeed.status.connected',
  disconnected: 'joinfeed.status.disconnected',
  error: 'joinfeed.status.error',
};

const fmtAgo = (d: Date): string => {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return i18n._('joinfeed.ago.seconds', { s });
  if (s < 3600) return i18n._('joinfeed.ago.minutes', { m: Math.round(s / 60) });
  return i18n._('joinfeed.ago.hours', { h: Math.round(s / 3600) });
};

export function JoinFeed() {
  const { status, error, candidates, connect, disconnect } = useJoinFeed();
  const t = useT();

  const isOpen = status === 'connected' || status === 'connecting';

  return (
    <Paper sx={{ p: 4 }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h6">{t('joinfeed.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('joinfeed.intro')}
            </Typography>
          </Box>
          <Chip
            icon={status === 'connected'
              ? <RadioButtonCheckedIcon fontSize="small" />
              : <RadioButtonUncheckedIcon fontSize="small" />}
            label={STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status}
            color={status === 'connected' ? 'success' : status === 'error' ? 'error' : 'default'}
            variant={status === 'connected' ? 'filled' : 'outlined'}
          />
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" spacing={2}>
          <Button onClick={connect} variant="contained" disabled={isOpen}>
            {t('joinfeed.button.connect')}
          </Button>
          <Button onClick={disconnect} variant="outlined" disabled={!isOpen}>
            {t('joinfeed.button.disconnect')}
          </Button>
        </Stack>

        {candidates.length === 0 ? (
          <Alert severity="info" variant="outlined">
            {status === 'connected'
              ? t('joinfeed.empty.connected')
              : t('joinfeed.empty.disconnected')}
          </Alert>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('joinfeed.table.devEui')}</TableCell>
                  <TableCell>{t('joinfeed.table.vendor')}</TableCell>
                  <TableCell>{t('joinfeed.table.gateways')}</TableCell>
                  <TableCell align="right">{t('joinfeed.table.lastSeen')}</TableCell>
                  <TableCell align="right">{t('joinfeed.table.retries')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow key={c.devEui}>
                    <TableCell><code>{c.devEui}</code></TableCell>
                    <TableCell>{c.vendor?.name ?? t('joinfeed.vendor.unknown')}</TableCell>
                    <TableCell>{c.gateways.join(', ')}</TableCell>
                    <TableCell align="right">{fmtAgo(c.lastSeen)}</TableCell>
                    <TableCell align="right">{c.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>
    </Paper>
  );
}
