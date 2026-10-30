import { COMPRESS_MAX_EDGE, COMPRESS_QUALITY, shouldCompress } from '@/domain/esh-evidence';

/**
 * v270 — a plant photograph, made small enough to send on one bar of signal.
 *
 * A modern phone camera produces eight to twelve megabytes per picture, and an
 * Action Owner attaching three of them from the factory floor is uploading
 * thirty megabytes over whatever signal the building has. Resized to 2000px
 * and re-encoded, the same photograph is usually under a megabyte and shows
 * exactly the same thing: nobody is reading a serial number off the evidence
 * for a blocked walkway.
 *
 * **What this costs.** Re-encoding through a canvas drops the EXIF block, so
 * the camera's own timestamp and any GPS co-ordinates do not survive. For this
 * product that is a fair trade — the record already carries who uploaded the
 * file, when, and against which finding, which is better provenance than a
 * phone clock anybody can change. It would not be a fair trade if the
 * photograph were ever evidence in a dispute about where or when, so this is
 * worth revisiting if the module ever supports incident investigation.
 *
 * Anything that cannot be decoded — HEIC on a browser without support, a
 * corrupt file, a PDF — is returned untouched rather than refused. Compression
 * is an optimisation, and an optimisation that loses somebody's evidence is a
 * defect.
 */
export async function compressImage(file: File): Promise<File> {
  if (!shouldCompress(file.type, file.size)) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  try {
    // `from-image` so a portrait photograph does not come out on its side:
    // the orientation lives in the EXIF this re-encode is about to drop.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > COMPRESS_MAX_EDGE ? COMPRESS_MAX_EDGE / longest : 1;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', COMPRESS_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], renameToJpeg(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

/** The name the owner sees should match what the file now is. */
function renameToJpeg(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.jpg`;
}
