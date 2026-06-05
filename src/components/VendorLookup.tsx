import { useState } from 'react';
import {
  Alert, Box, Paper, Stack, TextField, Typography,
} from '@mui/material';

import { detectVendor, parseQr } from '../lib/oui';
import type { QrParseResult, VendorInfo } from '../lib/oui';

/**
 * Diagnostic widget proving Phase 0 of the browser adapter chain works:
 * the bundled OUI registry JSON loads, the LoRaWAN QR decoder runs against
 * it without `fs`, and the vendor enrichment surfaces.
 *
 * Doubles as a useful sanity check when an operator suspects a QR is
 * malformed — paste any vendor's QR string and see what gets extracted.
 */
export function VendorLookup() {
  const [input, setInput] = useState('');
  const [eui, setEui] = useState('');

  const trimmed = input.trim();
  const looksLikeEui = /^[0-9A-Fa-f\s:_-]{16,}$/.test(trimmed);
  const looksLikeQr = !looksLikeEui && trimmed.length > 0;

  let parsed: QrParseResult | undefined;
  let parseErr: string | undefined;
  if (looksLikeQr) {
    try { parsed = parseQr(trimmed); }
    catch (err) { parseErr = err instanceof Error ? err.message : String(err); }
  }

  // Try direct EUI vendor lookup against either the typed EUI or the parsed DevEUI.
  const lookupTarget = parsed?.devEui ?? trimmed.replace(/[\s:_-]/g, '');
  const vendor: VendorInfo | undefined = lookupTarget.length === 16 ? detectVendor(lookupTarget) : undefined;

  return (
    <Paper sx={{ p: 4 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">Vendor lookup</Typography>
          <Typography variant="body2" color="text.secondary">
            Paste a QR string or a 16-char DevEUI. Confirms the local OUI
            registry + QR decoder are working in the browser.
          </Typography>
        </Box>

        <TextField
          label="QR string or DevEUI"
          placeholder="LW:D0:… or A84041035660E3AA"
          value={input}
          onChange={(e) => { setInput(e.target.value); setEui(e.target.value); }}
          multiline
          minRows={1}
          maxRows={4}
          autoComplete="off"
          spellCheck={false}
        />

        {parseErr && <Alert severity="warning">QR parse failed: {parseErr}</Alert>}

        {parsed && (
          <Alert severity="success">
            <Typography variant="body2" component="div">
              <strong>Strategy:</strong> {parsed.source}<br />
              <strong>DevEUI:</strong> <code>{parsed.devEui}</code><br />
              {parsed.joinEui && <><strong>JoinEUI:</strong> <code>{parsed.joinEui}</code><br /></>}
              {parsed.appKey && <><strong>AppKey:</strong> <code>{parsed.appKey}</code><br /></>}
              {parsed.serialNumber && <><strong>Serial:</strong> {parsed.serialNumber}<br /></>}
            </Typography>
          </Alert>
        )}

        {vendor ? (
          <Alert severity="info">
            <Typography variant="body2">
              <strong>Vendor:</strong> {vendor.name}
              {vendor.id && <> · slug <code>{vendor.id}</code></>}
              {vendor.knownLorawanVendor && ' · known LoRaWAN vendor'}
              {' '}(OUI <code>{vendor.oui}</code>)
            </Typography>
          </Alert>
        ) : lookupTarget.length === 16 && trimmed.length > 0 && (
          <Alert severity="info">
            OUI <code>{lookupTarget.slice(0, 6)}</code> not in registry.
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
