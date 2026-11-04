#!/usr/bin/env node
/**
 * Printable QR stickers for public safety reporting (v289).
 *
 * Generated here rather than on a website, because a sticker's code is the
 * whole of its authorisation: anybody who learns it can submit a report
 * against that location. Pasting the address into an online QR generator
 * hands that code to a third party, so this does it offline.
 *
 * Output goes to a sibling of the repository, never inside it — the same rule
 * the backups follow, for the same reason: these files should not be
 * committed by accident.
 *
 * Usage, with one argument per sticker, as `label=address`:
 *
 *   node scripts/make-qr.mjs "BR2 Press line 2=https://…/report/abc123" \
 *                            "BR1 Main gate=https://…/report/def456"
 *
 * The addresses come from Finding settings → QR locations, where each row has
 * a Copy button. Writes one SVG per sticker plus `index.html`, which is a
 * print-ready sheet: QR, the place in large type, and one line telling the
 * reader what it is for.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';

const repoRoot = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const outputRoot = path.join(repoRoot, '..', 'tamco-focus-qr');

/** A file name that cannot escape the output directory or surprise Windows. */
function slug(label) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'location'
  );
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const stickers = process.argv.slice(2).map((argument) => {
  const at = argument.indexOf('=');
  if (at < 1) {
    throw new Error(`Each argument must be "label=address"; got: ${argument.slice(0, 40)}`);
  }
  const label = argument.slice(0, at).trim();
  const url = argument.slice(at + 1).trim();
  if (!/^https?:\/\//.test(url)) throw new Error(`Not an address: ${url.slice(0, 40)}`);
  return { label, url };
});

if (stickers.length === 0) {
  console.log('Nothing to do. Pass one "label=address" per sticker.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.join(outputRoot, stamp);
mkdirSync(directory, { recursive: true });

const cards = [];
for (const sticker of stickers) {
  /*
   * Error correction level Q: a sticker on a plant floor gets scuffed, oiled
   * and partly covered, and Q survives about a quarter of the code being
   * unreadable. The margin stays at the standard four modules — scanners rely
   * on the quiet zone, and trimming it is the usual reason a printed code
   * will not read.
   */
  const svg = await QRCode.toString(sticker.url, {
    type: 'svg',
    errorCorrectionLevel: 'Q',
    margin: 4,
    width: 600,
  });
  const name = `${slug(sticker.label)}.svg`;
  writeFileSync(path.join(directory, name), svg, 'utf8');
  cards.push({ ...sticker, name, svg });
}

const sheet = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Safety reporting stickers</title>
<style>
  @page { margin: 12mm; }
  body { font-family: system-ui, sans-serif; margin: 0; }
  .sticker {
    page-break-inside: avoid;
    border: 2px solid #111;
    border-radius: 8mm;
    padding: 10mm;
    margin: 0 0 10mm;
    text-align: center;
    max-width: 150mm;
  }
  .sticker svg { width: 70mm; height: 70mm; }
  h2 { margin: 6mm 0 2mm; font-size: 20pt; }
  p { margin: 0; font-size: 12pt; line-height: 1.4; }
  .quiet { color: #444; font-size: 10pt; margin-top: 4mm; }
</style>
</head>
<body>
${cards
  .map(
    (card) => `<div class="sticker">
  ${card.svg}
  <h2>${escapeHtml(card.label)}</h2>
  <p><strong>Seen something unsafe? Scan this.</strong></p>
  <p>No account needed. You do not have to give your name.</p>
  <p class="quiet">If somebody is in immediate danger, stop and follow the site emergency procedure. This code does not raise an alarm.</p>
</div>`,
  )
  .join('\n')}
</body>
</html>
`;
writeFileSync(path.join(directory, 'index.html'), sheet, 'utf8');

console.log(`\n${cards.length} sticker${cards.length === 1 ? '' : 's'} written to:`);
console.log(`  ${directory}`);
console.log('\nOpen index.html and print it. Each address is live only while public');
console.log('reporting is open and its location is active.\n');
