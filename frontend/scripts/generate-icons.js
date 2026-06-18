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
    await sharp(input)
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 10, g: 10, b: 15, alpha: 1 }
      })
      .toFile(path.join(outDir, `icon-${size}x${size}.png`));
    console.log('Generated ' + size + 'x' + size);
  }
}
generate().catch(console.error);
