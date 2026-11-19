// Alta de empleados (pantalla Empleados). Ejecutar desde frontend/:  node --test tests/employees.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateEmployeeForm, buildEmployeePayload, createEmployee, emptyEmployeeForm } from '../src/lib/employees.js';

// Cliente HTTP falso con la forma de axios
function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    post: async (url, body) => {
      calls.push({ url, body });
      return respond(url, body);
    },
  };
}

test('crear: manda el payload limpio a POST /api/employees y devuelve el empleado', async () => {
  const client = fakeClient(() => ({ data: { success: true, data: { id: 'e1', name: 'Juan Pérez' } } }));
  const r = await createEmployee(client, { name: '  Juan Pérez ', email: ' juan@correo.com ', phone: '', commission_percent: '15' });
  assert.deepEqual(r, { ok: true, data: { id: 'e1', name: 'Juan Pérez' } });
  assert.deepEqual(client.calls, [{
    url: '/api/employees',
    body: { name: 'Juan Pérez', email: 'juan@correo.com', phone: null, commission_percent: 15 },
  }]);
});

test('crear con la comisión borrada (""): se manda 0, no "" (antes el backend daba 500)', async () => {
  const client = fakeClient(() => ({ data: { data: {} } }));
  await createEmployee(client, { ...emptyEmployeeForm, name: 'Ana', commission_percent: '' });
  assert.equal(client.calls[0].body.commission_percent, 0);
});

test('crear sin nombre o con comisión fuera de rango: no llama a la API', async () => {
  const client = fakeClient(() => { throw new Error('no debería llamarse'); });
  assert.deepEqual(await createEmployee(client, { ...emptyEmployeeForm, name: '   ' }), { ok: false, error: 'El nombre es obligatorio.' });
  assert.equal((await createEmployee(client, { name: 'Ana', commission_percent: 120 })).ok, false);
  assert.equal((await createEmployee(client, { name: 'Ana', commission_percent: -1 })).ok, false);
  assert.equal(client.calls.length, 0);
});

test('límite del plan: devuelve limitError con el mensaje del backend', async () => {
  const client = fakeClient(() => {
    const err = new Error('403');
    err.response = { data: { code: 'EMPLOYEES_LIMIT_REACHED', error: 'Alcanzaste el límite de 2 empleados' } };
    throw err;
  });
  assert.deepEqual(await createEmployee(client, { name: 'Ana' }), { ok: false, limitError: 'Alcanzaste el límite de 2 empleados' });
});

test('otro error: mensaje del backend o uno genérico', async () => {
  const withMsg = fakeClient(() => { const e = new Error('x'); e.response = { data: { error: 'Email inválido' } }; throw e; });
  assert.deepEqual(await createEmployee(withMsg, { name: 'Ana' }), { ok: false, error: 'Email inválido' });
  const network = fakeClient(() => { throw new Error('Network Error'); });
  assert.deepEqual(await createEmployee(network, { name: 'Ana' }), { ok: false, error: 'Error al guardar.' });
});

test('validación y payload', () => {
  assert.equal(validateEmployeeForm({ name: 'Ana', commission_percent: 0 }), null);
  assert.equal(validateEmployeeForm({ name: 'Ana', commission_percent: '' }), null);
  assert.equal(validateEmployeeForm({ name: 'Ana', commission_percent: 'abc' }), 'La comisión debe estar entre 0 y 100.');
  assert.deepEqual(buildEmployeePayload({ name: 'Ana' }), { name: 'Ana', email: null, phone: null, commission_percent: 0 });
});

test('Employees.jsx no referencia la mutación inexistente y usa el flujo probado', () => {
  const src = readFileSync(new URL('../src/pages/business/Employees.jsx', import.meta.url), 'utf8');
  assert.equal(/\bcreateMutation\b/.test(src), false);
  assert.match(src, /createEmployee\(api, form\)/);
});
