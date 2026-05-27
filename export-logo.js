const sharp = require('sharp');
const fs = require('fs');

const svg = fs.readFileSync('./frontend/public/favicon.svg');

// Exportar en varios tamaños
const sizes = [512, 1024];
for (const size of sizes) {
  sharp(svg)
    .resize(size, size)
    .png()
    .toFile(`zita-logo-${size}.png`)
    .then(() => console.log(`✓ zita-logo-${size}.png`));
}
