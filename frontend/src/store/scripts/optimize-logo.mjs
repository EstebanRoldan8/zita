// Genera los logos optimizados de Flow a partir del PNG original (15501 × 10417 px, ~900 KB).
// Uso (desde frontend/):  node src/store/scripts/optimize-logo.mjs
// Usa sharp, que ya está en node_modules (no se agrega como dependencia).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'assets', 'logo');
const src = path.join(dir, 'flow-logo-negro.png');
const WIDTH = 900;

// Recorta el margen transparente para que el logo se vea grande a la misma altura
const trimmed = await sharp(src, { limitInputPixels: false }).trim().png().toBuffer();
const base = sharp(trimmed).resize({ width: WIDTH, withoutEnlargement: true });

const negro = await base.clone().png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true });
await sharp(negro.data).toFile(path.join(dir, 'flow-logo-negro-900.png'));
await base.clone().webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(dir, 'flow-logo-negro.webp'));

// Blanco: invierte el color (negro → blanco) y conserva el canal alfa
const blanco = base.clone().negate({ alpha: false });
await blanco.clone().png({ compressionLevel: 9, palette: true }).toFile(path.join(dir, 'flow-logo-blanco.png'));
await blanco.clone().webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(dir, 'flow-logo-blanco.webp'));

console.log(`logos generados: ${negro.info.width} × ${negro.info.height} px`);
