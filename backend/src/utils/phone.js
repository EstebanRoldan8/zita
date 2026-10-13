// Celulares colombianos: 10 dígitos que empiezan por 3. Acepta "300 123 4567",
// "+57 300-123-4567" o "573001234567"; devuelve "573001234567" o null si no es válido.
function normalizeColombianPhone(value) {
  if (value === null || value === undefined) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
  if (!/^3\d{9}$/.test(digits)) return null;
  return `57${digits}`;
}

// Para logs: nunca el teléfono completo ("57300***4567")
function maskPhone(value) {
  const s = String(value || '');
  if (s.length < 7) return '***';
  return `${s.slice(0, 5)}***${s.slice(-4)}`;
}

module.exports = { normalizeColombianPhone, maskPhone };
