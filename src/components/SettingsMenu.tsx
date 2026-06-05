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
import LanguageIcon from '@mui/icons-material/Language';

import { useSettings } from '../state/settings';
import { SUPPORTED_LOCALES, useT, type MessageKey, type Locale } from '../i18n';

type Mode = 'system' | 'light' | 'dark';

const THEME_ICONS: Record<Mode, React.ReactElement> = {
  system: <SettingsBrightnessIcon fontSize="small" />,
  light: <LightModeIcon fontSize="small" />,
  dark: <DarkModeIcon fontSize="small" />,
};

const THEME_LABEL_KEYS: Record<Mode, MessageKey> = {
  system: 'menu.theme.system',
  light: 'menu.theme.light',
  dark: 'menu.theme.dark',
};

/**
 * Gear-icon menu in the AppBar. Houses every page-agnostic preference so the
 * operator never has to leave the active session to change one:
 *
 *   - Connection settings (navigates to /settings)
 *   - Theme override (system / light / dark)
 *   - UI language (English / Español / Italiano / Français / Deutsch /
 *     Português)
 *
 * Add new app-wide preferences here rather than spreading them across pages.
 */
export function SettingsMenu() {
  const navigate = useNavigate();
  const themeMode = useSettings((s) => s.themeMode ?? 'system');
  const locale = useSettings((s) => s.locale);
  const setSettings = useSettings((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const t = useT();

  const close = () => setOpen(false);

  return (
    <>
      <Tooltip title={t('menu.settings.tooltip')}>
        <IconButton
          ref={anchorRef}
          onClick={() => setOpen(true)}
          size="small"
          aria-label={t('menu.settings.tooltip')}
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
            primary={t('menu.connection.title')}
            secondary={t('menu.connection.subtitle')}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>

        <Divider />

        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ px: 2, py: 0.5, display: 'block', fontSize: 11 }}
        >
          {t('menu.theme.label')}
        </Typography>
        {(['system', 'light', 'dark'] as const).map((m) => (
          <MenuItem
            key={m}
            onClick={() => { setSettings({ themeMode: m }); close(); }}
            selected={themeMode === m}
          >
            <ListItemIcon>{THEME_ICONS[m]}</ListItemIcon>
            <ListItemText primary={t(THEME_LABEL_KEYS[m])} />
            {themeMode === m && <CheckIcon fontSize="small" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}

        <Divider />

        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ px: 2, py: 0.5, display: 'block', fontSize: 11 }}
        >
          {t('menu.language.label')}
        </Typography>
        {SUPPORTED_LOCALES.map((l, idx) => (
          <MenuItem
            key={l.code}
            // Setting `locale` triggers `LocaleProvider`'s effect which calls
            // i18n.activate() — all components subscribed via `useLingui()`
            // re-render with the new translations.
            onClick={() => { setSettings({ locale: l.code as Locale }); close(); }}
            selected={(locale ?? 'en') === l.code}
          >
            <ListItemIcon>
              {idx === 0 ? <LanguageIcon fontSize="small" /> : <span style={{ width: 20 }} />}
            </ListItemIcon>
            <ListItemText primary={l.label} />
            {(locale ?? 'en') === l.code && <CheckIcon fontSize="small" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
