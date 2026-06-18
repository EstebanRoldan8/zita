const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [192, 512];
const input = path.join(__dirname, '../public/logo.png');
const outDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function generate() {
  for (const size of sizes) {
    const padding = Math.round(size * 0.15);
    const innerSize = size - padding * 2;

    // Primero crear fondo negro del tamaño completo
    const background = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 10, g: 10, b: 15, alpha: 255 }
      }
    }).png().toBuffer();

    // Redimensionar el logo con transparencia
    const logo = await sharp(input)
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    // Componer: logo encima del fondo negro
    await sharp(background)
      .composite([{
        input: logo,
        top: padding,
        left: padding
      }])
      .toFile(path.join(outDir, `icon-${size}x${size}.png`));

    console.log('Generated ' + size + 'x' + size);

    // Generar íconos maskable para Android
    const safeZone = Math.round(size * 0.4);

    const maskableBackground = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 10, g: 10, b: 15, alpha: 255 }
      }
    }).png().toBuffer();

    const maskableLogo = await sharp(input)
      .resize(safeZone, safeZone, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    const offset = Math.round((size - safeZone) / 2);

    await sharp(maskableBackground)
      .composite([{
        input: maskableLogo,
        top: offset,
        left: offset
      }])
      .toFile(path.join(outDir, `icon-${size}x${size}-maskable.png`));

    console.log('Generated maskable ' + size + 'x' + size);
  }

  // Generar favicon transparente para PC
  await sharp(input)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(path.join(outDir, 'favicon-256.png'));
  console.log('Generated favicon-256 transparent');
}
generate().catch(console.error);
