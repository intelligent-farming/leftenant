// Uploaded-photo input for the Session page: an alternative to the live
// camera when it is blocked or unavailable, or when the label is easier to
// photograph than to hold steady in the viewfinder.
//
// A photo is drawn onto a canvas (honouring EXIF orientation, so a portrait
// phone shot isn't read sideways), then handed to the same QR decoder the
// live scanner uses and, failing that, to the OCR path.

import Scanner from 'qr-scanner';

// Phone photos run 12–50 MP. Neither the QR decoder nor OCR (which rescales
// to ~2200 px itself) benefits from more than this, and a smaller canvas
// keeps memory and decode time down on tablets.
const MAX_EDGE = 3000;

/**
 * Decode an image file to a canvas, upright per its EXIF orientation. Goes
 * through an <img> rather than createImageBitmap: browsers apply EXIF
 * orientation when drawing an image element (CSS `image-orientation:
 * from-image` is the default), whereas createImageBitmap's
 * `imageOrientation` option is inconsistently supported on older Safari.
 */
export const imageFileToCanvas = async (file: Blob): Promise<HTMLCanvasElement> => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** QR payload found in the image, or `null` when it contains no readable QR code. */
export const decodeQrFromImage = async (canvas: HTMLCanvasElement): Promise<string | null> => {
  try {
    const result = await Scanner.scanImage(canvas, { returnDetailedScanResult: true });
    return result.data || null;
  } catch {
    // qr-scanner rejects with "No QR code found" rather than resolving empty.
    return null;
  }
};
