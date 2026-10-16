// Genera la imagen por defecto de los previews (1200 × 630, logo negro sobre sand) y el logo público
// que usa el JSON-LD Organization. Reemplazar por una foto de campaña cuando exista.
// Uso (desde frontend/):  node src/store/scripts/og-image.mjs
// Usa sharp, que ya está en node_modules (no se agrega como dependencia).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const logo = path.join(here, '..', 'assets', 'logo', 'flow-logo-negro-900.png');
const pub = path.join(here, '..', '..', '..', 'public');
const SAND = '#D9CFC3';

const mark = await sharp(logo).resize({ width: 640 }).png().toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 3, background: SAND } })
  .composite([{ input: mark, gravity: 'center' }])
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile(path.join(pub, 'og-flow.jpg'));

// Logo cuadrado con margen (Google pide un logo legible; 600 × 600 sobre blanco)
const square = await sharp(logo).resize({ width: 480 }).png().toBuffer();
await sharp({ create: { width: 600, height: 600, channels: 3, background: '#FFFFFF' } })
  .composite([{ input: square, gravity: 'center' }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(path.join(pub, 'flow-logo.png'));

console.log('og-flow.jpg (1200 × 630) y flow-logo.png (600 × 600) generados en public/');
