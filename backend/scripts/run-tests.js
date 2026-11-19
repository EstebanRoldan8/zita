// npm test: corre con node --test todos los tests/*.test.js que no necesitan servidor ni base real.
// Excluidos: api.test.js (pega a un servidor levantado) y assistant.test.js (usa la base y Anthropic reales).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LIVE_ONLY = new Set(['api.test.js', 'assistant.test.js']);
const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.test.js') && !LIVE_ONLY.has(f))
  .sort()
  .map((f) => path.join('tests', f));

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(r.status ?? 1);
