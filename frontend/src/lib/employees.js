// Alta/edición de empleados (pantalla Empleados del dueño): validación, payload y llamada a la API.
// Lógica pura para poder probarla sin DOM (tests/employees.test.js).

export const emptyEmployeeForm = { name: '', email: '', phone: '', commission_percent: 0 };

// Error para mostrar o null si el formulario es válido
export function validateEmployeeForm(form) {
  if (!String(form?.name ?? '').trim()) return 'El nombre es obligatorio.';
  const raw = form?.commission_percent;
  if (raw !== '' && raw !== null && raw !== undefined) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return 'La comisión debe estar entre 0 y 100.';
  }
  return null;
}

// Lo que se manda al backend: textos recortados, vacíos como null y comisión numérica ('' → 0).
// Un '' en commission_percent (columna NUMERIC) hacía fallar el alta con un 500.
export function buildEmployeePayload(form) {
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t ? t : null;
  };
  const raw = form?.commission_percent;
  const commission = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
  return {
    name: String(form?.name ?? '').trim(),
    email: text(form?.email),
    phone: text(form?.phone),
    commission_percent: Number.isFinite(commission) ? commission : 0,
  };
}

// Crea el empleado. Devuelve { ok: true, data } | { ok: false, limitError } | { ok: false, error }
export async function createEmployee(client, form) {
  const invalid = validateEmployeeForm(form);
  if (invalid) return { ok: false, error: invalid };
  try {
    const res = await client.post('/api/employees', buildEmployeePayload(form));
    return { ok: true, data: res?.data?.data ?? null };
  } catch (err) {
    const body = err?.response?.data;
    if (body?.code === 'EMPLOYEES_LIMIT_REACHED') return { ok: false, limitError: body.error };
    return { ok: false, error: body?.error || 'Error al guardar.' };
  }
}
