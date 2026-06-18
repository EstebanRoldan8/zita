const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [192, 512];
const input = path.join(__dirname, '../public/logo.png');
const outDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function generate() {
  for (const size of sizes) {
    const padding = Math.round(size * 0.08);
    const innerSize = size - padding * 2;

    // Ícono transparente (para PC - purpose: any)
    await sharp(input)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(outDir, `icon-${size}x${size}-any.png`));
    console.log('Generated icon-' + size + 'x' + size + '-any (transparent)');

    // Ícono con fondo negro (para Android - purpose: maskable)
    const background = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 10, g: 10, b: 15, alpha: 255 }
      }
    }).png().toBuffer();

    const logo = await sharp(input)
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    await sharp(background)
      .composite([{ input: logo, top: padding, left: padding }])
      .toFile(path.join(outDir, `icon-${size}x${size}-maskable.png`));
    console.log('Generated icon-' + size + 'x' + size + '-maskable (dark bg)');
  }

  // Favicon transparente para PC
  await sharp(input)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, 'favicon-256.png'));
  console.log('Generated favicon-256 (transparent)');
}
generate().catch(console.error);
