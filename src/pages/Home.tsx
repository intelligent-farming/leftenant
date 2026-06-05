import { useNavigate } from 'react-router-dom';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip,
  Grid, Paper, Stack, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LinearScaleIcon from '@mui/icons-material/LinearScale';
// Note: the old "Edit connection" button now lives in the AppBar settings
// dropdown (see SettingsMenu) — reachable from every page, not just Home.

import { useSettings } from '../state/settings';
import { useSession } from '../state/session';

import { AppShell } from '../components/AppShell';
import { VendorLookup } from '../components/VendorLookup';
import { JoinFeed } from '../components/JoinFeed';
import { ModelPicker } from '../components/ModelPicker';

export function HomePage() {
  const settings = useSettings();
  const session = useSession((s) => s.active);
  const submissionCount = useSession((s) => s.submissions.length);
  const navigate = useNavigate();

  return (
    <AppShell>
      <Stack spacing={3}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            ChirpStack <code>{settings.chirpStackUrl}</code>{' '}
            · MQTT <code>{settings.mqttUrl}</code>
          </Typography>
        </Box>

        {session ? (
          <Paper sx={{ p: { xs: 3, md: 4 } }}>
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Chip color="success" label="Session active" size="small" />
                <Typography variant="caption" color="text.secondary">
                  {submissionCount} device{submissionCount === 1 ? '' : 's'} added so far
                </Typography>
              </Stack>
              <Typography variant="h6">{session.modelName}</Typography>
              <Typography variant="body2" color="text.secondary">
                Going into {session.applicationName} · profile {session.deviceProfileName}
              </Typography>
              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  onClick={() => navigate('/session')}
                  startIcon={<LinearScaleIcon />}
                >
                  Resume session
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ) : (
          <Paper sx={{ p: { xs: 3, md: 4 } }}>
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h6">Start an onboarding session</Typography>
              <Typography variant="body2" color="text.secondary">
                Pick a device model, application, and profile once — then loop:
                scan QR, submit, repeat. Built for batches of 1 to thousands of
                identical devices.
              </Typography>
              <Button
                variant="contained"
                size="large"
                onClick={() => navigate('/session/new')}
                startIcon={<PlayArrowIcon />}
              >
                New session
              </Button>
            </Stack>
          </Paper>
        )}

        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">Diagnostics</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
              vendor lookup · model preview · live join feed
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {/*
              Two-column grid on wide screens — the three diagnostic widgets
              are independent and benefit from side-by-side comparison. On
              narrow screens they stack vertically.
            */}
            <Grid container spacing={3}>
              <Grid item xs={12} lg={6}>
                <VendorLookup />
              </Grid>
              <Grid item xs={12} lg={6}>
                <ModelPicker />
              </Grid>
              <Grid item xs={12}>
                <JoinFeed />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </AppShell>
  );
}
