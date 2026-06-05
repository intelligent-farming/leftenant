import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  AppBar, Box, Container, Stack, Toolbar,
  type Breakpoint,
} from '@mui/material';

import { SettingsMenu } from './SettingsMenu';
import logoWordmark from '../assets/leftenant-logo-wordmark.png';

export interface AppShellProps {
  children: ReactNode;
  /**
   * MUI breakpoint cap for the main content container. Defaults to `'xl'`
   * (1536 px) — lets wide screens spread out, narrower stays comfortable.
   * Pass `false` for true full-width with no cap.
   */
  maxWidth?: Breakpoint | false;
  /** Extra controls in the AppBar's right slot (next to the theme toggle). */
  toolbarRight?: ReactNode;
}

/**
 * App-level chrome: thin AppBar at the top with the brand mark + theme
 * toggle, then the page's main content in a width-constrained container.
 *
 * Pages opt in by wrapping their content in `<AppShell>...</AppShell>`. The
 * shell is intentionally minimal — no nav drawer, no breadcrumbs — Leftenant
 * is a 3-page app and routing is already in the buttons.
 */
export function AppShell({ children, maxWidth = 'xl', toolbarRight }: AppShellProps) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          backgroundColor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 56 }}>
          <Box
            component={RouterLink}
            to="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            <Box
              component="img"
              src={logoWordmark}
              alt="Leftenant"
              sx={{
                height: 36,
                width: 'auto',
                display: 'block',
              }}
            />
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={0.5} alignItems="center">
            {toolbarRight}
            <SettingsMenu />
          </Stack>
        </Toolbar>
      </AppBar>
      <Container
        maxWidth={maxWidth}
        sx={{ flexGrow: 1, py: { xs: 2, md: 3 }, width: '100%' }}
      >
        {children}
      </Container>
    </Box>
  );
}
