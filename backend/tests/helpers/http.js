// Helpers para probar controladores y middlewares de Express sin levantar servidor.
//   const { call } = require('./helpers/http');
//   const r = await call(handler, { params: { id }, body: {...}, businessId, role: 'owner' });
//   r.status, r.body, r.nextCalled
const path = require('path');

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    set(k, v) { if (typeof k === 'object') Object.assign(res.headers, k); else res.headers[k] = v; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    send(payload) { res.body = payload; return res; },
  };
  return res;
}

function mockReq(over = {}) {
  return {
    method: 'GET',
    originalUrl: '/',
    headers: { authorization: 'Bearer test' },
    params: {},
    query: {},
    body: {},
    user: { id: 'user-owner' },
    business: { id: over.businessId, country: 'colombia', plan: 'pro', name: 'Barbería Test' },
    ...over,
  };
}

// Ejecuta un handler (o una cadena de middlewares) y devuelve status/body y si llamó a next()
async function call(handlers, reqOver = {}) {
  const list = Array.isArray(handlers) ? handlers : [handlers];
  const req = mockReq(reqOver);
  const res = mockRes();
  let nextCalled = false;
  for (const h of list) {
    let advanced = false;
    await h(req, res, (err) => { if (err) throw err; advanced = true; });
    nextCalled = advanced;
    if (!advanced) break;
  }
  return { status: res.statusCode, body: res.body, nextCalled, req };
}

// Reemplaza un módulo de src/ en la caché de require (antes de requerir quien lo usa)
function stubModule(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', 'src', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// Borra de la caché los módulos de src/ indicados para volver a cargarlos con otros dobles
function freshRequire(rel) {
  const p = require.resolve(path.join(__dirname, '..', '..', 'src', rel));
  delete require.cache[p];
  return require(p);
}

module.exports = { call, mockReq, mockRes, stubModule, freshRequire };
