function removeAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeString(str) {
  return removeAccents(str)
    .toUpperCase()
    .replace(/Ñ/g, 'N')
    .replace(/\s+/g, '');
}

function generarSku(categoria, nombre, atributos = {}) {
  let skuParts = [];

  if (categoria) {
    const catNorm = normalizeString(categoria);
    skuParts.push(catNorm);
  } else if (nombre) {
    const words = nombre.trim().split(/\s+/);
    if (words.length > 0) {
      const firstWordNorm = normalizeString(words[0]);
      skuParts.push(firstWordNorm);
    }
  }

  if (nombre) {
    const words = nombre.trim().split(/\s+/);
    if (words.length > 0) {
      let wordToAdd = null;

      for (const word of words) {
        if (word.length > 2) {
          const wordNorm = normalizeString(word);
          if (!skuParts.length || wordNorm !== skuParts[0]) {
            wordToAdd = wordNorm;
            break;
          }
        }
      }

      if (!wordToAdd) {
        const firstWordNorm = normalizeString(words[0]);
        if (firstWordNorm && (skuParts.length === 0 || firstWordNorm !== skuParts[0])) {
          wordToAdd = firstWordNorm;
        }
      }

      if (wordToAdd) {
        skuParts.push(wordToAdd);
      }
    }
  }

  const attrOrder = ['talla', 'size', 'color', 'tamaño'];
  for (const key of attrOrder) {
    if (atributos[key]) {
      const attrNorm = normalizeString(String(atributos[key]));
      skuParts.push(attrNorm);
    }
  }

  return skuParts.join('-');
}

module.exports = { generarSku };
