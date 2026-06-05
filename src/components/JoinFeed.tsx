import {
  Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import { useJoinFeed } from '../hooks/useJoinFeed';

const fmtAgo = (d: Date): string => {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export function JoinFeed() {
  const { status, error, candidates, connect, disconnect } = useJoinFeed();

  const isOpen = status === 'connected' || status === 'connecting';

  return (
    <Paper sx={{ p: 4 }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h6">Live join feed</Typography>
            <Typography variant="body2" color="text.secondary">
              Listens to gateway-level JoinRequest messages — including from
              devices ChirpStack hasn't been told about yet.
            </Typography>
          </Box>
          <Chip
            icon={status === 'connected'
              ? <RadioButtonCheckedIcon fontSize="small" />
              : <RadioButtonUncheckedIcon fontSize="small" />}
            label={status}
            color={status === 'connected' ? 'success' : status === 'error' ? 'error' : 'default'}
            variant={status === 'connected' ? 'filled' : 'outlined'}
          />
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" spacing={2}>
          <Button onClick={connect} variant="contained" disabled={isOpen}>
            Connect
          </Button>
          <Button onClick={disconnect} variant="outlined" disabled={!isOpen}>
            Disconnect
          </Button>
        </Stack>

        {candidates.length === 0 ? (
          <Alert severity="info" variant="outlined">
            {status === 'connected'
              ? 'No join requests heard yet. Power a device on near a gateway.'
              : 'Click connect to start listening.'}
          </Alert>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>DevEUI</TableCell>
                  <TableCell>Vendor</TableCell>
                  <TableCell>Gateways</TableCell>
                  <TableCell align="right">Last seen</TableCell>
                  <TableCell align="right">Retries</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow key={c.devEui}>
                    <TableCell><code>{c.devEui}</code></TableCell>
                    <TableCell>{c.vendor?.name ?? 'unknown'}</TableCell>
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
