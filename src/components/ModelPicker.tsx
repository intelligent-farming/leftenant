import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, FormControl, InputLabel, MenuItem,
  Paper, Select, Stack, TextField, Typography, Chip,
} from '@mui/material';

import { searchHits, toChirpStack, Region, type SearchHit, type ChirpStackV4DeviceProfile } from '../lib/ttn';

const REGIONS: Array<{ label: string; value: string }> = [
  { label: 'EU868 (Europe 863-870)', value: Region.EU868 },
  { label: 'US915 (Americas 902-928)', value: Region.US915 },
  { label: 'AS923', value: Region.AS923 },
  { label: 'AU915 (915-928)', value: Region.AU915 },
  { label: 'KR920 (920-923)', value: Region.KR920 },
  { label: 'IN865 (865-867)', value: Region.IN865 },
  { label: 'RU864 (864-870)', value: Region.RU864 },
  { label: 'CN470 (470-510)', value: Region.CN470 },
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
  const [region, setRegion] = useState<string>(Region.US915);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SearchHit | null>(null);

  // Debounce-free: searchHits is in-memory and fast.
  const hits = useMemo<SearchHit[]>(() => query.length >= 2 ? searchHits(query, 20) : [], [query]);

  // Build a profile only when both selection and region are set AND the
  // device supports the chosen region. Default target is v4 — the
  // ChirpStack version Leftenant ships against.
  let profile: ChirpStackV4DeviceProfile | undefined;
  let profileError: string | undefined;
  if (selected) {
    if (!selected.regions.includes(region)) {
      profileError = `${selected.name} doesn't list ${region} as a supported region. Try one of: ${selected.regions.join(', ')}.`;
    } else {
      try { profile = toChirpStack(selected.vendor, selected.device, region as Region); }
      catch (err) { profileError = err instanceof Error ? err.message : String(err); }
    }
  }

  return (
    <Paper sx={{ p: 4 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">Device model picker</Typography>
          <Typography variant="body2" color="text.secondary">
            Search the bundled TTN catalog and preview the ChirpStack profile
            that would be created. The session-onboarding flow will use this
            same lookup.
          </Typography>
        </Box>

        <FormControl size="small" sx={{ maxWidth: 320 }}>
          <InputLabel>Region</InputLabel>
          <Select value={region} label="Region" onChange={(e) => setRegion(e.target.value)}>
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
            <TextField {...params} label="Search device (vendor, model, friendly name)" placeholder='Try "dragino lds02"' />
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
          noOptionsText={query.length < 2 ? 'Type 2+ characters to search' : 'No matches'}
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
