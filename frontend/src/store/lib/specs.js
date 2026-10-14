// Líneas "Etiqueta: valor" de la descripción del producto (Tela, Beneficios, Uso, Cuidado, Modelo).
// Si no hay ninguna, `specs` queda vacío y la descripción se muestra tal cual.
const SPEC_LABELS = ['tela', 'beneficios', 'uso', 'cuidado', 'modelo'];
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function parseSpecs(description) {
  const text = typeof description === 'string' ? description : '';
  const specs = [];
  const rest = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]{2,20}):\s*(.+)$/);
    const label = m ? m[1].trim() : '';
    if (m && SPEC_LABELS.includes(plain(label))) {
      specs.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value: m[2].trim() });
    } else if (line.trim()) {
      rest.push(line.trim());
    }
  }
  return { specs, rest: rest.join('\n') };
}
