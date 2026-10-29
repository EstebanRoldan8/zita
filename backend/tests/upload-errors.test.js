// Rechazos de subida de imágenes → 400. Ejecutar: node --test tests/upload-errors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const multer = require('multer');
const { handleUploadErrors, MULTER_MESSAGES } = require('../src/middlewares/uploadErrors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 },
  fileFilter: (req, file, cb) => (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Solo se permiten JPG, PNG o WebP'))),
});

function call(mw, err) {
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let nexted = false;
  handleUploadErrors((req, r, cb) => cb(err))({}, res, () => { nexted = true; });
  return { res, nexted };
}

test('sin error: sigue al siguiente middleware', () => {
  const { res, nexted } = call(null, undefined);
  assert.equal(nexted, true);
  assert.equal(res.code, null);
});
test('archivo demasiado grande → 400 con mensaje en español', () => {
  const { res, nexted } = call(null, Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' }));
  assert.equal(nexted, false);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, MULTER_MESSAGES.LIMIT_FILE_SIZE);
});
test('tipo inválido → 400 con el mensaje del filtro', () => {
  const { res } = call(null, new Error('Solo se permiten JPG, PNG o WebP'));
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'Solo se permiten JPG, PNG o WebP');
});

test('integración con multer real: no-imagen y archivo grande → 400; imagen válida → pasa', async () => {
  const app = express();
  app.post('/up', handleUploadErrors(upload.single('image')), (req, res) => res.json({ ok: true, size: req.file.size }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/up`;
  const send = (buf, type) => {
    const fd = new FormData();
    fd.append('image', new Blob([buf], { type }), 'f');
    return fetch(url, { method: 'POST', body: fd });
  };
  try {
    assert.equal((await send(Buffer.from('hola'), 'text/plain')).status, 400);
    const big = await send(Buffer.alloc(2048, 1), 'image/png');
    assert.equal(big.status, 400);
    assert.equal((await big.json()).error, MULTER_MESSAGES.LIMIT_FILE_SIZE);
    assert.equal((await send(Buffer.alloc(100, 1), 'image/png')).status, 200);
  } finally {
    server.close();
  }
});
