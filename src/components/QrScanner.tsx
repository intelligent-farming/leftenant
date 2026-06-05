import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import Scanner from 'qr-scanner';

/**
 * Thin React wrapper around the `qr-scanner` library. Wires up a `<video>`
 * element, requests camera permission, and fires `onScan` once per detection.
 *
 * Re-scans are throttled by `cooldownMs` so a single physical QR doesn't
 * fire dozens of times while in view — practical for batch onboarding where
 * the operator wants exactly one event per device.
 */
export interface QrScannerProps {
  /** Called when the scanner decodes a frame. */
  onScan: (text: string) => void;
  /** When `false`, the camera is paused (saves battery, releases the camera light). Default `true`. */
  active?: boolean;
  /**
   * Minimum ms between consecutive `onScan` callbacks for the same payload.
   * Default 2000 — long enough that the operator has time to move the device
   * away after a successful scan, short enough not to feel sluggish.
   */
  cooldownMs?: number;
}

/** Imperative methods callers can invoke via a `ref`. */
export interface QrScannerHandle {
  /**
   * Grab the current video frame as a canvas. Returns `null` if the camera
   * isn't streaming yet (permission pending / denied / unavailable, or the
   * stream just started and hasn't produced its first frame).
   */
  captureFrame(): HTMLCanvasElement | null;
}

type Permission = 'pending' | 'granted' | 'denied' | 'unavailable';

export const QrScanner = forwardRef<QrScannerHandle, QrScannerProps>(function QrScanner(
  { onScan, active = true, cooldownMs = 2000 },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<Scanner | null>(null);
  const lastScan = useRef<{ text: string; at: number } | null>(null);
  const [permission, setPermission] = useState<Permission>('pending');
  const [error, setError] = useState<string | undefined>();

  // Initialize the scanner once on mount.
  useEffect(() => {
    if (!videoRef.current) return;
    let cancelled = false;

    const scanner = new Scanner(
      videoRef.current,
      (result) => {
        const now = Date.now();
        const text = result.data;
        const recent = lastScan.current;
        if (recent && recent.text === text && now - recent.at < cooldownMs) return;
        lastScan.current = { text, at: now };
        onScan(text);
      },
      {
        // Use rear camera by default — every batch-onboarding tablet is held
        // with the camera pointing AT the device label.
        preferredCamera: 'environment',
        highlightScanRegion: true,
        highlightCodeOutline: true,
        // Scan more frequently than the default for snappier batch loops.
        maxScansPerSecond: 8,
      },
    );
    scannerRef.current = scanner;

    Scanner.hasCamera()
      .then((has) => {
        if (cancelled) return;
        if (!has) {
          setPermission('unavailable');
          return;
        }
        return scanner.start().then(() => {
          if (cancelled) return;
          setPermission('granted');
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/permission|notallowed|denied/i.test(msg)) setPermission('denied');
        else setPermission('unavailable');
        setError(msg);
      });

    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause / resume when the `active` prop flips.
  useEffect(() => {
    const scanner = scannerRef.current;
    if (!scanner || permission !== 'granted') return;
    if (active) {
      void scanner.start();
    } else {
      scanner.stop();
    }
  }, [active, permission]);

  // Re-attempt `scanner.start()` without reloading the page. Used by the
  // "Camera blocked" Retry button so the user keeps any in-progress form
  // state on the Session page. If the browser still rejects, fall through
  // to the same permission/unavailable error states as the initial mount.
  const retry = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    setPermission('pending');
    setError(undefined);
    try {
      await scanner.start();
      setPermission('granted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/permission|notallowed|denied/i.test(msg)) setPermission('denied');
      else setPermission('unavailable');
      setError(msg);
    }
  };

  // Expose `captureFrame()` to callers via ref. Used by the Session page's
  // OCR path: it grabs the current viewfinder frame and runs Tesseract on it.
  useImperativeHandle(ref, () => ({
    captureFrame: () => {
      const video = videoRef.current;
      if (!video) return null;
      // Browsers don't paint a meaningful frame until the stream's first
      // metadata arrives; videoWidth being 0 means we'd capture a blank canvas.
      if (!video.videoWidth || !video.videoHeight) return null;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);
      return canvas;
    },
  }), []);

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          backgroundColor: 'grey.900',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        {/*
          Always render the video. qr-scanner attaches the stream and calls
          play() — if the element were `display: none` at that moment the
          browser starts the camera with a 0×0 viewport, and flipping display
          later doesn't re-trigger the layout pipeline reliably. Overlays
          (loading/denied) sit on top via absolute positioning.

          `playsInline` keeps iOS Safari from fullscreening the stream;
          `muted` is required for autoplay on most platforms.
        */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        {permission !== 'granted' && (
          <Stack
            sx={{
              position: 'absolute', inset: 0,
              alignItems: 'center', justifyContent: 'center',
              color: 'grey.300', textAlign: 'center', p: 3,
              backgroundColor: 'grey.900',
              zIndex: 1,
            }}
            spacing={1}
          >
            {permission === 'pending' && <Typography variant="body2">Requesting camera…</Typography>}
            {permission === 'denied' && (
              <>
                <VideocamOffIcon fontSize="large" />
                <Typography variant="subtitle1">Camera blocked</Typography>
                <Typography variant="body2">
                  Grant camera permission in your browser to scan QR codes. You
                  can still type DevEUI / JoinEUI / AppKey below.
                </Typography>
              </>
            )}
            {permission === 'unavailable' && (
              <>
                <VideocamOffIcon fontSize="large" />
                <Typography variant="subtitle1">No camera available</Typography>
                <Typography variant="body2">
                  This device has no usable camera. Use the manual entry form
                  below.
                </Typography>
              </>
            )}
          </Stack>
        )}
      </Box>
      {error && permission === 'denied' && (
        <Alert
          severity="warning"
          action={
            <Button size="small" onClick={retry}>Retry</Button>
          }
        >
          {error}
        </Alert>
      )}
    </Stack>
  );
});
