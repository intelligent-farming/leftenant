import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress,
  Divider, FormControl, FormControlLabel, InputLabel, MenuItem, Paper,
  Radio, RadioGroup, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

import { AppShell } from '../components/AppShell';

import {
  searchHits, toChirpStack, Region, MacVersion, RegParamsRevision,
  PayloadCodecRuntime, type SearchHit,
} from '../lib/ttn';
import { CodeEditor } from '../components/CodeEditor';
import {
  createChirpStackClient, listAllApplications, listAllDeviceProfiles,
  ensureDeviceProfile, profileNameFor, ChirpStackApiError,
  type ApplicationSummary, type DeviceProfileSummary,
} from '../lib/chirpstack-api';
import { useSettings } from '../state/settings';
import { useSession } from '../state/session';

// Region picker rows. The `ttn` value drives the catalog search (TTN
// region IDs like "US902-928"); the `chirpstack` value is what gets sent
// to ChirpStack when building a profile manually.
const REGIONS: Array<{ label: string; ttn: string; chirpstack: string }> = [
  { label: 'US915 (Americas)', ttn: Region.US915, chirpstack: 'US915' },
  { label: 'EU868 (Europe)', ttn: Region.EU868, chirpstack: 'EU868' },
  { label: 'AS923', ttn: Region.AS923, chirpstack: 'AS923' },
  { label: 'AU915', ttn: Region.AU915, chirpstack: 'AU915' },
  { label: 'KR920', ttn: Region.KR920, chirpstack: 'KR920' },
  { label: 'IN865', ttn: Region.IN865, chirpstack: 'IN865' },
  { label: 'RU864', ttn: Region.RU864, chirpstack: 'RU864' },
  { label: 'CN470', ttn: Region.CN470, chirpstack: 'CN470' },
];

const MAC_VERSIONS = [
  MacVersion.LORAWAN_1_0_0,
  MacVersion.LORAWAN_1_0_1,
  MacVersion.LORAWAN_1_0_2,
  MacVersion.LORAWAN_1_0_3,
  MacVersion.LORAWAN_1_0_4,
  MacVersion.LORAWAN_1_1_0,
];

const REG_PARAMS = [
  RegParamsRevision.A,
  RegParamsRevision.B,
  RegParamsRevision.RP002_1_0_0,
  RegParamsRevision.RP002_1_0_1,
  RegParamsRevision.RP002_1_0_2,
  RegParamsRevision.RP002_1_0_3,
];

type Mode = 'catalog' | 'manual' | 'existing';
type AppChoice = 'existing' | 'new';

/** Map a ChirpStack region (e.g. `"US915"`) back to the TTN key for session state. */
const chirpstackToTtnRegion = (chirpstackRegion: string): string => {
  const match = REGIONS.find((r) => r.chirpstack === chirpstackRegion);
  return match?.ttn ?? chirpstackRegion;
};

/** Strip a free-text model name down to a kebab-case profile-name suffix. */
const slug = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device';

export function SessionSetupPage() {
  const settings = useSettings();
  const startSession = useSession((s) => s.startSession);
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('catalog');
  const [region, setRegion] = useState<string>(Region.US915);

  // Catalog mode state.
  const [modelQuery, setModelQuery] = useState('');
  const [model, setModel] = useState<SearchHit | null>(null);

  // Manual mode state.
  const [manualName, setManualName] = useState('');
  const [manualMacVersion, setManualMacVersion] = useState<string>(MacVersion.LORAWAN_1_0_3);
  const [manualRegParams, setManualRegParams] = useState<string>(RegParamsRevision.A);
  const [manualOtaa, setManualOtaa] = useState(true);
  const [manualClassB, setManualClassB] = useState(false);
  const [manualClassC, setManualClassC] = useState(false);
  const [manualCodec, setManualCodec] = useState('');

  // Existing-profile mode state.
  const [profiles, setProfiles] = useState<DeviceProfileSummary[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | undefined>();
  const [selectedProfile, setSelectedProfile] = useState<DeviceProfileSummary | null>(null);
  const [profileQuery, setProfileQuery] = useState('');

  // Application picker state (shared across modes).
  const [appChoice, setAppChoice] = useState<AppChoice>('existing');
  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState<string | undefined>();
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [newAppName, setNewAppName] = useState('');

  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!settings.configured) return;
    let cancelled = false;
    // Connection settings changed — invalidate prior selections so we don't
    // hold on to IDs from the previous tenant (which would resolve to a 404
    // on createDevice). Clearing here keeps the Start button correctly
    // disabled until the user re-picks from the new tenant's options.
    setSelectedAppId('');
    setSelectedProfile(null);
    setAppsLoading(true);
    setProfilesLoading(true);
    setAppsError(undefined);
    setProfilesError(undefined);
    const client = createChirpStackClient({
      chirpStackUrl: settings.chirpStackUrl,
      apiKey: settings.apiKey,
    });
    const tenantId = settings.tenantId ?? '';

    // Apps + profiles loaded in parallel — both are tenant-scoped lists
    // the user might browse for the session.
    listAllApplications(client, tenantId)
      .then((list) => {
        if (cancelled) return;
        setApps(list);
        if (list.length > 0 && !selectedAppId) setSelectedAppId(list[0].id);
        if (list.length === 0) setAppChoice('new');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAppsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setAppsLoading(false);
      });

    listAllDeviceProfiles(client, tenantId)
      .then((list) => {
        if (cancelled) return;
        setProfiles(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProfilesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setProfilesLoading(false);
        client.close();
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chirpStackUrl, settings.apiKey, settings.tenantId]);

  const modelHits = useMemo<SearchHit[]>(
    () => modelQuery.length >= 2 ? searchHits(modelQuery, 20) : [],
    [modelQuery],
  );

  const regionRow = REGIONS.find((r) => r.ttn === region) ?? REGIONS[0];
  const modelRegionMismatch = mode === 'catalog' && model && !model.regions.includes(region);

  const canStart = (() => {
    if (working) return false;
    if (mode === 'catalog') {
      if (!model || !model.regions.includes(region)) return false;
    } else if (mode === 'manual') {
      if (manualName.trim().length === 0) return false;
    } else {
      if (!selectedProfile) return false;
    }
    return appChoice === 'existing' ? !!selectedAppId : newAppName.trim().length > 0;
  })();

  const onStart = async () => {
    setError(undefined);
    setWorking(true);
    const client = createChirpStackClient({
      chirpStackUrl: settings.chirpStackUrl,
      apiKey: settings.apiKey,
    });
    const tenantId = settings.tenantId ?? '';
    try {
      // 1. Resolve the application first — same logic for every mode.
      let applicationId = selectedAppId;
      let applicationName = apps.find((a) => a.id === selectedAppId)?.name ?? '';
      if (appChoice === 'new') {
        const created = await client.createApplication({
          tenantId,
          name: newAppName.trim(),
          description: 'Created by Leftenant during onboarding session',
        });
        applicationId = created.id;
        applicationName = newAppName.trim();
      }

      // 2. Resolve the device profile — three modes, three paths:
      //    a) catalog  → build a TTN profile, ensure-or-create in ChirpStack
      //    b) manual   → build profile from form values, ensure-or-create
      //    c) existing → use the picked ChirpStack profile as-is, no create
      let deviceProfileId: string;
      let deviceProfileName: string;
      let vendorSlug: string;
      let deviceSlug: string;
      let modelName: string;
      let sessionRegion: string;        // stored TTN region for the session
      let sessionMacVersion: string;    // drives 1.0.x vs 1.1.x key collection on the Session page

      if (mode === 'existing' && selectedProfile) {
        deviceProfileId = selectedProfile.id;
        deviceProfileName = selectedProfile.name;
        vendorSlug = 'existing';
        deviceSlug = slug(selectedProfile.name);
        modelName = selectedProfile.name;
        sessionRegion = chirpstackToTtnRegion(selectedProfile.region);
        sessionMacVersion = selectedProfile.macVersion;
      } else {
        let ttnProfile: Parameters<typeof ensureDeviceProfile>[2];
        let chirpstackRegion: string;
        if (mode === 'catalog' && model) {
          const v4 = toChirpStack(model.vendor, model.device, region as Region);
          ttnProfile = {
            region: v4.region,
            macVersion: v4.macVersion,
            regParamsRevision: v4.regParamsRevision,
            supportsOtaa: v4.supportsOtaa,
            supportsClassB: v4.supportsClassB,
            supportsClassC: v4.supportsClassC,
            classBTimeout: v4.classBTimeout,
            classCTimeout: v4.classCTimeout,
            payloadCodecRuntime: v4.payloadCodecRuntime,
            payloadCodecScript: v4.payloadCodecScript,
            name: v4.name,
            description: v4.description,
          };
          vendorSlug = model.vendor;
          deviceSlug = model.device;
          modelName = model.name;
          chirpstackRegion = v4.region;
        } else {
          ttnProfile = {
            region: regionRow.chirpstack,
            macVersion: manualMacVersion,
            regParamsRevision: manualRegParams,
            supportsOtaa: manualOtaa,
            supportsClassB: manualClassB,
            supportsClassC: manualClassC,
            payloadCodecRuntime: manualCodec.trim()
              ? PayloadCodecRuntime.JS
              : PayloadCodecRuntime.NONE,
            payloadCodecScript: manualCodec.trim() ? manualCodec : undefined,
            name: manualName.trim(),
            description: 'Manually configured via Leftenant',
          };
          vendorSlug = 'custom';
          deviceSlug = slug(manualName);
          modelName = manualName.trim();
          chirpstackRegion = regionRow.chirpstack;
        }
        const profileName = profileNameFor(deviceSlug, chirpstackRegion);
        const profile = await ensureDeviceProfile(client, tenantId, ttnProfile, profileName);
        deviceProfileId = profile.id;
        deviceProfileName = profile.name;
        sessionRegion = region;
        sessionMacVersion = ttnProfile.macVersion;
      }

      // 3. Start the session.
      startSession({
        vendor: vendorSlug,
        device: deviceSlug,
        region: sessionRegion,
        modelName,
        applicationId,
        applicationName,
        deviceProfileId,
        deviceProfileName,
        macVersion: sessionMacVersion,
      });
      navigate('/session');
    } catch (err) {
      setError(err instanceof ChirpStackApiError ? err.message
        : err instanceof Error ? err.message
        : String(err));
    } finally {
      client.close();
      setWorking(false);
    }
  };

  const previewProfileName = (() => {
    if (mode === 'catalog' && model) {
      const v4 = toChirpStack(
        model.vendor, model.device,
        (model.regions.includes(region) ? region : model.regions[0]) as Region,
      );
      return profileNameFor(model.device, v4.region);
    }
    if (mode === 'manual' && manualName.trim()) {
      return profileNameFor(slug(manualName), regionRow.chirpstack);
    }
    if (mode === 'existing' && selectedProfile) {
      return selectedProfile.name;
    }
    return null;
  })();

  // The region selector at the top doesn't apply when the profile is
  // already chosen — the existing profile carries its own region.
  const showRegionSelector = mode !== 'existing';

  return (
    <AppShell maxWidth="md">
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" gutterBottom>New onboarding session</Typography>
          <Typography variant="body1" color="text.secondary">
            Pick the model, region, and application once. Every device added
            during the session will inherit them.
          </Typography>
        </Box>

        <Paper sx={{ p: 3 }}>
          <Stack spacing={2.5}>
            <Typography variant="h6">Device model</Typography>
            {showRegionSelector && (
              <FormControl size="small">
                <InputLabel>Region</InputLabel>
                <Select value={region} label="Region" onChange={(e) => setRegion(e.target.value)}>
                  {REGIONS.map((r) => (
                    <MenuItem key={r.ttn} value={r.ttn}>{r.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <Tabs value={mode} onChange={(_, v: Mode) => setMode(v)}>
              <Tab value="catalog" label="From catalog" />
              <Tab value="manual" label="Manual entry" />
              <Tab value="existing" label="Existing profile" />
            </Tabs>

            {mode === 'catalog' && (
              <Stack spacing={2}>
                <Autocomplete
                  options={modelHits}
                  getOptionLabel={(o) => `${o.name} (${o.vendor}/${o.device})`}
                  isOptionEqualToValue={(a, b) => a.vendor === b.vendor && a.device === b.device}
                  value={model}
                  onChange={(_, v) => setModel(v)}
                  inputValue={modelQuery}
                  onInputChange={(_, v) => setModelQuery(v)}
                  filterOptions={(x) => x}
                  renderInput={(params) => (
                    <TextField {...params} label="Search device" placeholder='Try "dragino lds02"' />
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
                  noOptionsText={modelQuery.length < 2 ? 'Type 2+ characters to search' : 'No matches — switch to Manual entry to enter the profile by hand'}
                />
                {modelRegionMismatch && (
                  <Alert severity="warning">
                    {model!.name} doesn't list {region}. Supported regions: {model!.regions.join(', ')}
                  </Alert>
                )}
              </Stack>
            )}

            {mode === 'manual' && (
              <Stack spacing={2}>
                <Alert severity="info" variant="outlined">
                  Use this when your device isn't in the bundled TTN catalog,
                  or when you need a custom profile shape. Fields map directly
                  to ChirpStack's <code>DeviceProfile</code>.
                </Alert>
                <TextField
                  label="Model name"
                  placeholder="My Sensor v2"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  helperText="Used for device names and the auto-generated profile name."
                  autoComplete="off"
                />
                <Stack direction="row" spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>MAC version</InputLabel>
                    <Select
                      value={manualMacVersion}
                      label="MAC version"
                      onChange={(e) => setManualMacVersion(e.target.value)}
                    >
                      {MAC_VERSIONS.map((v) => (
                        <MenuItem key={v} value={v}>{v}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Reg params</InputLabel>
                    <Select
                      value={manualRegParams}
                      label="Reg params"
                      onChange={(e) => setManualRegParams(e.target.value)}
                    >
                      {REG_PARAMS.map((v) => (
                        <MenuItem key={v} value={v}>{v}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <FormControlLabel
                    control={<Checkbox checked={manualOtaa} onChange={(e) => setManualOtaa(e.target.checked)} />}
                    label="OTAA"
                  />
                  <FormControlLabel
                    control={<Checkbox checked={manualClassB} onChange={(e) => setManualClassB(e.target.checked)} />}
                    label="Class B"
                  />
                  <FormControlLabel
                    control={<Checkbox checked={manualClassC} onChange={(e) => setManualClassC(e.target.checked)} />}
                    label="Class C"
                  />
                </Stack>
                <CodeEditor
                  label="Payload codec (optional JavaScript)"
                  value={manualCodec}
                  onChange={setManualCodec}
                  minRows={4}
                  maxRows={16}
                  placeholder="function decodeUplink({ fPort, bytes }) { return { data: { … } }; }"
                  helperText="Paste a TTN-style JS codec. Leave empty for no codec."
                />
              </Stack>
            )}

            {mode === 'existing' && (
              <Stack spacing={2}>
                <Alert severity="info" variant="outlined">
                  Pick a profile that already exists in this tenant. No new
                  profile gets created — devices added during the session use
                  the one you select. The region comes from the profile.
                </Alert>
                {profilesError && <Alert severity="error">{profilesError}</Alert>}
                <Autocomplete
                  options={profiles}
                  loading={profilesLoading}
                  getOptionLabel={(p) => p.name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  value={selectedProfile}
                  onChange={(_, v) => setSelectedProfile(v)}
                  inputValue={profileQuery}
                  onInputChange={(_, v) => setProfileQuery(v)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={profilesLoading ? 'Loading profiles…' : `Search profiles (${profiles.length})`}
                      placeholder="dragino lds02 — US915"
                      InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {profilesLoading && <CircularProgress size={16} />}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                  renderOption={(props, opt) => (
                    <li {...props} key={opt.id}>
                      <Stack spacing={0.25}>
                        <span>{opt.name}</span>
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                          <Chip size="small" label={opt.region} />
                          <Chip size="small" label={opt.macVersion} variant="outlined" />
                          <Chip size="small" label={`reg ${opt.regParamsRevision}`} variant="outlined" />
                          {opt.supportsOtaa && <Chip size="small" label="OTAA" color="primary" variant="outlined" />}
                          {opt.supportsClassB && <Chip size="small" label="Class B" variant="outlined" />}
                          {opt.supportsClassC && <Chip size="small" label="Class C" variant="outlined" />}
                        </Stack>
                      </Stack>
                    </li>
                  )}
                  noOptionsText={profilesLoading ? 'Loading…' : profiles.length === 0 ? 'No profiles in this tenant yet — use Catalog or Manual to create one' : 'No matches'}
                />
                {selectedProfile && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Region {selectedProfile.region} · MAC {selectedProfile.macVersion} · reg-params {selectedProfile.regParamsRevision}
                    </Typography>
                  </Box>
                )}
              </Stack>
            )}
          </Stack>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Stack spacing={2.5}>
            <Typography variant="h6">Application</Typography>
            {appsError && <Alert severity="error">{appsError}</Alert>}
            <RadioGroup value={appChoice} onChange={(e) => setAppChoice(e.target.value as AppChoice)}>
              <FormControlLabel
                value="existing"
                control={<Radio />}
                label="Use existing application"
                disabled={appsLoading || apps.length === 0}
              />
              {appChoice === 'existing' && (
                <Box sx={{ ml: 4, mb: 2 }}>
                  {appsLoading ? (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CircularProgress size={16} />
                      <Typography variant="body2">Loading applications…</Typography>
                    </Stack>
                  ) : apps.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No applications in this tenant yet. Pick "Create new".
                    </Typography>
                  ) : (
                    <FormControl size="small" fullWidth>
                      <InputLabel>Application</InputLabel>
                      <Select
                        value={selectedAppId}
                        label="Application"
                        onChange={(e) => setSelectedAppId(e.target.value)}
                      >
                        {apps.map((a) => (
                          <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
              )}

              <FormControlLabel value="new" control={<Radio />} label="Create new application" />
              {appChoice === 'new' && (
                <Box sx={{ ml: 4 }}>
                  <TextField
                    label="Application name"
                    value={newAppName}
                    onChange={(e) => setNewAppName(e.target.value)}
                    placeholder="Greenhouse sensors"
                    size="small"
                    fullWidth
                  />
                </Box>
              )}
            </RadioGroup>
          </Stack>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Stack spacing={1.5}>
            <Typography variant="h6">Device profile</Typography>
            <Typography variant="body2" color="text.secondary">
              Leftenant will look for an existing profile named{' '}
              {previewProfileName
                ? <code>{previewProfileName}</code>
                : <em>(fill in the model section first)</em>}
              {' '}and create one if it's missing.
            </Typography>
          </Stack>
        </Paper>

        {error && <Alert severity="error">{error}</Alert>}

        <Divider />

        <Stack direction="row" spacing={2} justifyContent="space-between" alignItems="center">
          <Button onClick={() => navigate('/')} disabled={working}>Cancel</Button>
          <Button
            onClick={onStart}
            variant="contained"
            startIcon={working ? <CircularProgress size={16} /> : <PlayArrowIcon />}
            disabled={!canStart || working}
          >
            {working ? 'Setting up…' : 'Start session'}
          </Button>
        </Stack>
      </Stack>
    </AppShell>
  );
}
