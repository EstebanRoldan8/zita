// Género del producto: 'mujer' | 'hombre' | 'unisex'. La tienda decide con él en qué sección sale (Mujer / Hombre).
const GENDERS = ['mujer', 'hombre', 'unisex'];

// undefined = no viene (no se toca); null o '' = vuelve al valor por defecto; texto = se valida
function parseGender(value) {
  if (value === undefined) return { skip: true };
  if (value === null || value === '') return { value: 'mujer' };
  if (typeof value !== 'string') return { error: `Género inválido. Usa: ${GENDERS.join(', ')}.` };
  const g = value.trim().toLowerCase();
  if (!GENDERS.includes(g)) return { error: `Género inválido. Usa: ${GENDERS.join(', ')}.` };
  return { value: g };
}

module.exports = { GENDERS, parseGender };
