import { useMemo, type ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import type { PaletteMode } from '@mui/material';

import { createAppTheme } from './theme';
import { useSettings } from './state/settings';
import { SettingsPage } from './pages/Settings';
import { HomePage } from './pages/Home';
import { SessionSetupPage } from './pages/SessionSetup';
import { SessionPage } from './pages/Session';

export function App() {
  // Three sources resolve to the active palette mode:
  //   1. User override saved in settings (`light` / `dark`)
  //   2. OS preference via `prefers-color-scheme`
  //   3. Fallback to `light`
  const themeOverride = useSettings((s) => s.themeMode ?? 'system');
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode: PaletteMode = themeOverride === 'system'
    ? (systemPrefersDark ? 'dark' : 'light')
    : themeOverride;

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/session/new" element={<Gated><SessionSetupPage /></Gated>} />
          <Route path="/session" element={<Gated><SessionPage /></Gated>} />
          <Route path="/" element={<Gated><HomePage /></Gated>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

function Gated({ children }: { children: ReactElement }) {
  const configured = useSettings((s) => s.configured);
  return configured ? children : <Navigate to="/settings" replace />;
}
