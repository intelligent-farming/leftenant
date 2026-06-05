import { createTheme, type Theme, type PaletteMode } from '@mui/material/styles';

// Deep blue / warm amber in light mode; brighter blue / amber on slate in
// dark mode. The dark variant intentionally stays close to the light one's
// brand feel — same primary hue, just lifted for legibility on black.
//
// Both modes pick warning/success/error from Tailwind's 500-600 stops because
// those carry the same perceived weight under most ambient light conditions
// — important for a tool used in greenhouses and on construction sites where
// the screen contrast may be poor.

const lightPalette = {
  mode: 'light' as const,
  primary: { main: '#1e3a5f' },
  secondary: { main: '#d97706' },
  success: { main: '#16a34a' },
  error: { main: '#dc2626' },
  warning: { main: '#ca8a04' },
  background: {
    default: '#f5f5f4',
    paper: '#ffffff',
  },
};

const darkPalette = {
  mode: 'dark' as const,
  primary: { main: '#60a5fa', contrastText: '#0f172a' },     // sky-400
  secondary: { main: '#fbbf24' },                            // amber-400
  success: { main: '#4ade80' },                              // green-400
  error: { main: '#f87171' },                                // red-400
  warning: { main: '#fbbf24' },
  background: {
    default: '#0f172a',                                       // slate-900
    paper: '#1e293b',                                         // slate-800
  },
  divider: 'rgba(148, 163, 184, 0.18)',                      // slate-400 @ 18%
};

export const createAppTheme = (mode: PaletteMode): Theme => createTheme({
  palette: mode === 'dark' ? darkPalette : lightPalette,
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiTextField: { defaultProps: { variant: 'outlined', fullWidth: true } },
    MuiPaper: { defaultProps: { variant: 'outlined' } },
    MuiAlert: {
      styleOverrides: {
        // Outlined alerts on dark backgrounds default to a near-invisible
        // border. Lift them off the surface a little.
        outlined: ({ theme }) => theme.palette.mode === 'dark'
          ? { backgroundColor: 'rgba(148, 163, 184, 0.05)' }
          : {},
      },
    },
  },
});

/** Convenience for tests / one-off renders that don't need mode switching. */
export const theme = createAppTheme('light');
