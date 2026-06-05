import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, FormControl, InputLabel, MenuItem,
  Paper, Select, Stack, TextField, Typography, Chip,
} from '@mui/material';

import * as ttn from '@intelligent-farming/ttn-to-chirpstack/browser';

import { useT } from '../i18n';

const REGIONS: Array<{ label: string; value: string }> = [
  { label: 'EU868 (Europe 863-870)', value: ttn.Region.EU868 },
  { label: 'US915 (Americas 902-928)', value: ttn.Region.US915 },
  { label: 'AS923', value: ttn.Region.AS923 },
  { label: 'AU915 (915-928)', value: ttn.Region.AU915 },
  { label: 'KR920 (920-923)', value: ttn.Region.KR920 },
  { label: 'IN865 (865-867)', value: ttn.Region.IN865 },
  { label: 'RU864 (864-870)', value: ttn.Region.RU864 },
  { label: 'CN470 (470-510)', value: ttn.Region.CN470 },
];

/**
 * Phase 0 verification widget: searches the bundled TTN catalog and shows
 * the generated ChirpStack profile shape for the picked device + region.
 *
 * Doubles as a building block for the eventual session-setup screen — the
 * Autocomplete here is roughly what that flow needs, just dropped onto the
 * home page so the integration can be sanity-checked end-to-end.
 */
export function ModelPicker() {
  const [region, setRegion] = useState<string>(ttn.Region.US915);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ttn.SearchHit | null>(null);
  const t = useT();

  // Debounce-free: searchHits is in-memory and fast.
  const hits = useMemo<ttn.SearchHit[]>(() => query.length >= 2 ? ttn.searchHits(query, 20) : [], [query]);

  // Build a profile only when both selection and region are set AND the
  // device supports the chosen region. Default target is v4 — the
  // ChirpStack version Leftenant ships against.
  let profile: ttn.ChirpStackV4DeviceProfile | undefined;
  let profileError: string | undefined;
  if (selected) {
    if (!selected.regions.includes(region)) {
      profileError = t('model.region_mismatch', { name: selected.name, region, regions: selected.regions.join(', ') });
    } else {
      try { profile = ttn.toChirpStack(selected.vendor, selected.device, region as ttn.Region); }
      catch (err) { profileError = err instanceof Error ? err.message : String(err); }
    }
  }

  return (
    <Paper sx={{ p: 4 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">{t('model.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('model.intro')}
          </Typography>
        </Box>

        <FormControl size="small" sx={{ maxWidth: 320 }}>
          <InputLabel>{t('model.region.label')}</InputLabel>
          <Select value={region} label={t('model.region.label')} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => (
              <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Autocomplete
          options={hits}
          getOptionLabel={(o) => `${o.name} (${o.vendor}/${o.device})`}
          isOptionEqualToValue={(a, b) => a.vendor === b.vendor && a.device === b.device}
          value={selected}
          onChange={(_, v) => setSelected(v)}
          inputValue={query}
          onInputChange={(_, v) => setQuery(v)}
          filterOptions={(x) => x}      // server-side search; don't re-filter
          renderInput={(params) => (
            <TextField {...params} label={t('model.search.label')} placeholder={t('model.search.placeholder')} />
          )}
          renderOption={(props, opt) => (
            <li {...props} key={`${opt.vendor}/${opt.device}`}>
              <Stack>
                <span>{opt.name}</span>
                <Typography variant="caption" color="text.secondary">
                  {opt.vendor}/{opt.device} · {opt.regions.join(', ')}
                </Typography>
              </Stack>
            </li>
          )}
          noOptionsText={query.length < 2 ? t('model.noOptions.short') : t('model.noOptions.empty')}
        />

        {profileError && <Alert severity="warning">{profileError}</Alert>}

        {profile && (
          <Alert severity="success">
            <Typography variant="body2" component="div">
              <strong>{profile.name}</strong>
              <br />
              {profile.description}
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                <Chip size="small" label={profile.region} />
                <Chip size="small" label={profile.macVersion} />
                <Chip size="small" label={`reg-params ${profile.regParamsRevision}`} />
                {profile.supportsOtaa && <Chip size="small" label="OTAA" color="primary" />}
                {profile.supportsClassB && <Chip size="small" label="Class B" />}
                {profile.supportsClassC && <Chip size="small" label="Class C" />}
                {profile.payloadCodecRuntime === 'JS' && <Chip size="small" label="JS codec" color="secondary" />}
              </Stack>
            </Typography>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
