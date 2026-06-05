import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem,
  Tooltip, Typography,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import RouterIcon from '@mui/icons-material/Router';
import CheckIcon from '@mui/icons-material/Check';

import { useSettings } from '../state/settings';

type Mode = 'system' | 'light' | 'dark';

const THEME_ICONS: Record<Mode, React.ReactElement> = {
  system: <SettingsBrightnessIcon fontSize="small" />,
  light: <LightModeIcon fontSize="small" />,
  dark: <DarkModeIcon fontSize="small" />,
};

const THEME_LABELS: Record<Mode, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

/**
 * Gear-icon menu in the AppBar. Houses every page-agnostic preference so the
 * operator never has to leave the active session to change one:
 *
 *   - Connection settings (navigates to /settings)
 *   - Theme override (system / light / dark)
 *
 * Add new app-wide preferences here rather than spreading them across pages.
 */
export function SettingsMenu() {
  const navigate = useNavigate();
  const themeMode = useSettings((s) => s.themeMode ?? 'system');
  const setSettings = useSettings((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const close = () => setOpen(false);

  return (
    <>
      <Tooltip title="Settings">
        <IconButton
          ref={anchorRef}
          onClick={() => setOpen(true)}
          size="small"
          aria-label="Settings"
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        open={open}
        anchorEl={anchorRef.current}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        <MenuItem
          onClick={() => { close(); navigate('/settings'); }}
        >
          <ListItemIcon><RouterIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary="Connection settings"
            secondary="ChirpStack URL · API key · MQTT broker"
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>

        <Divider />

        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ px: 2, py: 0.5, display: 'block', fontSize: 11 }}
        >
          Theme
        </Typography>
        {(['system', 'light', 'dark'] as const).map((m) => (
          <MenuItem
            key={m}
            onClick={() => { setSettings({ themeMode: m }); close(); }}
            selected={themeMode === m}
          >
            <ListItemIcon>{THEME_ICONS[m]}</ListItemIcon>
            <ListItemText primary={THEME_LABELS[m]} />
            {themeMode === m && <CheckIcon fontSize="small" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
