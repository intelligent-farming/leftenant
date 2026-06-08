import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Button, Checkbox,
  CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import {
  createChirpStackClient, listAllApplications, listAllDevices,
  type ApplicationSummary, type DeviceSummary,
} from '../lib/chirpstack-api';
import { useSettings } from '../state/settings';
import { useT } from '../i18n';

/**
 * Bulk device removal: pick an application, tick the devices to remove, and
 * delete them from ChirpStack after a confirmation. Deletions run one at a
 * time so a single failure (e.g. a device removed out-of-band) doesn't abort
 * the rest — the result summary reports any that didn't go through.
 */
export function DeviceManager() {
  const settings = useSettings();
  const t = useT();

  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState<string | undefined>();
  const [selectedAppId, setSelectedAppId] = useState('');

  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | undefined>();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: { devEui: string; error: string }[] } | undefined>();
  // Collapsed by default. Data isn't fetched until first expansion, so a
  // collapsed card costs nothing on every Home load.
  const [expanded, setExpanded] = useState(false);

  const tenantId = settings.tenantId ?? '';
  const conn = { chirpStackUrl: settings.chirpStackUrl, apiKey: settings.apiKey };

  // Load applications once expanded (and whenever the connection/tenant
  // changes while open).
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setApps([]);
    setSelectedAppId('');
    setAppsError(undefined);
    setAppsLoading(true);
    const client = createChirpStackClient(conn);
    listAllApplications(client, tenantId)
      .then((list) => {
        if (cancelled) return;
        setApps(list);
        if (list.length > 0) setSelectedAppId(list[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setAppsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setAppsLoading(false);
        client.close();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, settings.chirpStackUrl, settings.apiKey, settings.tenantId]);

  // Track the in-flight device load so a stale response (app switched mid-load)
  // can't clobber the current selection's list.
  const loadSeq = useRef(0);
  const loadDevices = useCallback(async (appId: string) => {
    if (!appId) {
      setDevices([]);
      setSelected(new Set());
      return;
    }
    const seq = ++loadSeq.current;
    setDevicesLoading(true);
    setDevicesError(undefined);
    const client = createChirpStackClient({ chirpStackUrl: settings.chirpStackUrl, apiKey: settings.apiKey });
    try {
      const list = await listAllDevices(client, appId);
      if (seq !== loadSeq.current) return;
      setDevices(list);
      setSelected(new Set());
    } catch (err) {
      if (seq === loadSeq.current) setDevicesError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === loadSeq.current) setDevicesLoading(false);
      client.close();
    }
  }, [settings.chirpStackUrl, settings.apiKey]);

  useEffect(() => {
    setResult(undefined);
    void loadDevices(selectedAppId);
  }, [selectedAppId, loadDevices]);

  const toggleOne = (devEui: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(devEui)) next.delete(devEui);
      else next.add(devEui);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === devices.length ? new Set() : new Set(devices.map((d) => d.devEui))));
  };

  const onConfirmDelete = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    setResult(undefined);
    const targets = devices.filter((d) => selected.has(d.devEui));
    const client = createChirpStackClient({ chirpStackUrl: settings.chirpStackUrl, apiKey: settings.apiKey });
    let ok = 0;
    const failed: { devEui: string; error: string }[] = [];
    try {
      for (const d of targets) {
        try {
          await client.deleteDevice(d.devEui);
          ok += 1;
        } catch (err) {
          failed.push({ devEui: d.devEui, error: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      client.close();
      setDeleting(false);
      setResult({ ok, failed });
      await loadDevices(selectedAppId);
    }
  };

  const selectedApp = apps.find((a) => a.id === selectedAppId);
  const allChecked = devices.length > 0 && selected.size === devices.length;
  const someChecked = selected.size > 0 && !allChecked;

  return (
    <Accordion variant="outlined" disableGutters expanded={expanded} onChange={(_, isExpanded) => setExpanded(isExpanded)}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1">{t('home.devices.title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
          {t('home.devices.subtitle')}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
      <Stack spacing={2}>
        {appsError && <Alert severity="error">{appsError}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 240 }} disabled={appsLoading || apps.length === 0 || deleting}>
            <InputLabel>{t('home.devices.app.label')}</InputLabel>
            <Select
              value={selectedAppId}
              label={t('home.devices.app.label')}
              onChange={(e) => setSelectedAppId(e.target.value)}
            >
              {apps.map((a) => (
                <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {appsLoading && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">{t('home.devices.app.loading')}</Typography>
            </Stack>
          )}
          {!appsLoading && apps.length === 0 && !appsError && (
            <Typography variant="body2" color="text.secondary">{t('home.devices.app.none')}</Typography>
          )}
          {selectedAppId && (
            <Tooltip title={t('home.devices.refresh')}>
              <span>
                <IconButton size="small" onClick={() => loadDevices(selectedAppId)} disabled={devicesLoading || deleting}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>

        {result && (
          <Alert severity={result.failed.length === 0 ? 'success' : 'warning'}>
            {result.failed.length === 0
              ? t('home.devices.result.success', { count: result.ok })
              : t('home.devices.result.partial', { ok: result.ok, failed: result.failed.length })}
          </Alert>
        )}

        {devicesError && <Alert severity="error">{devicesError}</Alert>}

        {selectedAppId && (
          devicesLoading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">{t('home.devices.loading')}</Typography>
            </Stack>
          ) : devices.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              {t('home.devices.empty')}
            </Typography>
          ) : (
            <>
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={allChecked}
                          indeterminate={someChecked}
                          onChange={toggleAll}
                          disabled={deleting}
                          inputProps={{ 'aria-label': t('home.devices.selectAll') }}
                        />
                      </TableCell>
                      <TableCell>{t('home.devices.col.name')}</TableCell>
                      <TableCell>{t('home.devices.col.devEui')}</TableCell>
                      <TableCell>{t('home.devices.col.profile')}</TableCell>
                      <TableCell>{t('home.devices.col.lastSeen')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {devices.map((d) => {
                      const checked = selected.has(d.devEui);
                      return (
                        <TableRow
                          key={d.devEui}
                          hover
                          selected={checked}
                          onClick={() => !deleting && toggleOne(d.devEui)}
                          sx={{ cursor: deleting ? 'default' : 'pointer' }}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={checked}
                              disabled={deleting}
                              inputProps={{ 'aria-label': t('home.devices.selectOne') }}
                            />
                          </TableCell>
                          <TableCell>{d.name}</TableCell>
                          <TableCell><code>{d.devEui}</code></TableCell>
                          <TableCell>{d.deviceProfileName}</TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {d.lastSeenAt ? d.lastSeenAt.toLocaleString() : t('home.devices.lastSeen.never')}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              <Stack direction="row" spacing={2} justifyContent="flex-end" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  {t('home.devices.selectedCount', { count: selected.size })}
                </Typography>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon />}
                  disabled={selected.size === 0 || deleting}
                  onClick={() => setConfirmOpen(true)}
                >
                  {deleting ? t('home.devices.delete.working') : t('home.devices.delete.button', { count: selected.size })}
                </Button>
              </Stack>
            </>
          )
        )}
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{t('home.devices.confirm.title', { count: selected.size })}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('home.devices.confirm.body', { appName: selectedApp?.name ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('home.devices.confirm.cancel')}</Button>
          <Button onClick={onConfirmDelete} color="error" variant="contained">
            {t('home.devices.confirm.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
      </AccordionDetails>
    </Accordion>
  );
}
