import {
  COMPRESS_MAX_EDGE,
  COMPRESS_QUALITY,
  preferPng,
  scaledTo,
  shouldCompress,
} from '@/domain/esh-evidence';

/**
 * v270 — a plant photograph, made small enough to send on one bar of signal.
 * v271 — and the one that came off the camera, handed back rather than lost.
 *
 * A modern phone camera produces eight to twelve megabytes per picture, and an
 * Action Owner attaching three of them from the factory floor is uploading
 * thirty megabytes over whatever signal the building has. Resized to 2000px
 * and re-encoded, the same photograph is usually under a megabyte and shows
 * exactly the same thing: nobody is reading a serial number off the evidence
 * for a blocked walkway.
 *
 * **What re-encoding costs.** Drawing through a canvas drops the EXIF block,
 * so the camera's own timestamp and any GPS co-ordinates do not survive, and
 * everything past 2000px is gone. For getting work reported that is a fair
 * trade. For the one photograph somebody later has to argue about it is the
 * wrong one, and which photograph that turns out to be is not knowable at the
 * moment of upload.
 *
 * So v271 stops choosing. `copy` is what is sent first and what everybody
 * views; `source` is the untouched file, which the caller uploads afterwards,
 * in the background, into the same private bucket. The owner waits for
 * neither.
 *
 * Anything that cannot be decoded — HEIC on a browser without support, a
 * corrupt file, a PDF — comes back as the copy with no source beside it,
 * because there is nothing to preserve: those bytes were never altered.
 * Compression is an optimisation, and an optimisation that loses somebody's
 * evidence is a defect.
 */
export interface StagedFile {
  /** What goes up first, and what the conversation shows. */
  copy: File;
  /** The file as it was chosen, when that is not the same bytes. */
  source: File | null;
}

/**
 * v285 — the same re-encode, with the knobs the caller may need.
 *
 * Public safety reporting has its own numbers: a longer edge, because a
 * hazard photographed from across a bay needs the detail, and every photo
 * re-encoded rather than only the big ones, because that re-encode is what
 * removes the EXIF block and with it the GPS co-ordinates of whoever was
 * standing there. Staff evidence keeps its own defaults, unchanged.
 */
export interface CompressOptions {
  maxEdge?: number;
  quality?: number;
  /** Re-encode even a small file - for EXIF removal rather than for size. */
  always?: boolean;
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<StagedFile> {
  const maxEdge = options.maxEdge ?? COMPRESS_MAX_EDGE;
  const quality = options.quality ?? COMPRESS_QUALITY;
  const untouched: StagedFile = { copy: file, source: null };
  if (!options.always && !shouldCompress(file.type, file.size)) return untouched;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return untouched;

  try {
    // `from-image` so a portrait photograph does not come out on its side:
    // the orientation lives in the EXIF this re-encode is about to drop.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = scaledTo(bitmap.width, bitmap.height, maxEdge);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return untouched;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const jpeg = await encode(canvas, 'image/jpeg', quality);
    /*
     * v285 - a PNG is only converted when JPEG clearly wins.
     *
     * Screenshots of permits and labels arrive as PNG, and JPEG puts a
     * coloured halo around thin dark text while saving almost nothing on flat
     * colour. Encoding both and comparing decides it without having to guess
     * what the picture is of; a photograph is several times smaller as a JPEG
     * and takes that path, a screenshot stays a PNG at its new size.
     */
    const asPng = file.type.toLowerCase() === 'image/png';
    const png = asPng ? await encode(canvas, 'image/png') : null;
    const keepPng = asPng && png !== null && (jpeg === null || preferPng(png.size, jpeg.size));
    const blob = keepPng ? png : jpeg;

    /*
     * A re-encode that saved nothing is not worth having, and the database
     * refuses a source file that is not larger than its copy anyway — the two
     * rules are the same rule, so the one that runs first says so here.
     */
    if (!blob || blob.size >= file.size) return untouched;

    return {
      copy: new File([blob], keepPng ? file.name : renameToJpeg(file.name), {
        type: keepPng ? 'image/png' : 'image/jpeg',
        lastModified: file.lastModified,
      }),
      source: file,
    };
  } catch {
    return untouched;
  }
}

/** The name the owner sees should match what the file now is. */
function renameToJpeg(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.jpg`;
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
