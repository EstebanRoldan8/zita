// Doble en memoria de supabase-js para tests del bot y del asistente (sin red, sin base real).
// Soporta: select (con embeds simples por *_id), eq/neq/in/is/gte/lte/gt/lt/ilike/not, order, limit,
// single/maybeSingle, insert/update/upsert/delete (con .select()), count/head, rpc y restricciones únicas.
//
// Uso:
//   const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
//   const fake = createFakeSupabase({ appointments: [...], ... }, { unique: { wa_processed_messages: [['message_id']] } });
//   installFakes(fake);              // antes de requerir los servicios
const path = require('path');
const crypto = require('crypto');

const EMBEDS = { services: 'service_id', employees: 'employee_id', clients: 'client_id', businesses: 'business_id' };

function cmp(a, b) {
  const da = typeof a === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a) ? Date.parse(a) : NaN;
  const db = typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(b) ? Date.parse(b) : NaN;
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}
function ilikeToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (ch === '%') re += '.*'; else if (ch === '_') re += '.'; else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function createFakeSupabase(seed = {}, opts = {}) {
  const db = seed;
  const unique = opts.unique || {};
  const missingTables = new Set(opts.missingTables || []);
  const calls = [];

  // Columnas de primer nivel del SELECT ("id, name, services(name)") → ['id', 'name'] (null si es '*')
  function plainCols(cols) {
    if (!cols || cols.includes('*')) return null;
    let depth = 0; let cur = ''; const out = [];
    for (const ch of cols) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter((c) => !c.includes('(')).map((c) => c.split(':').pop().trim());
  }

  function withEmbeds(row, cols) {
    const keep = plainCols(cols);
    const out = keep ? Object.fromEntries(keep.map((k) => [k, row[k]])) : { ...row };
    for (const [rel, fk] of Object.entries(EMBEDS)) {
      if (cols && !cols.includes(`${rel}(`) && !cols.includes(`${rel}!`)) continue;
      if (row[fk] !== undefined) out[rel] = (db[rel] || []).find((r) => r.id === row[fk]) || null;
    }
    return out;
  }

  function from(table) {
    const filters = []; let op = 'select'; let payload = null; let one = null; let cols = '*';
    let order = null; let lim = null; let countMode = null; let head = false; let returning = false; let onConflict = null;
    const err = (code, message) => ({ data: null, error: { code, message }, count: null });

    function matches(r) { return filters.every((f) => f(r)); }
    function checkUnique(row, ignoreId) {
      for (const colsU of unique[table] || []) {
        const dup = (db[table] || []).find((r) => r !== ignoreId && colsU.every((c) => r[c] === row[c] && row[c] !== undefined && row[c] !== null));
        if (dup) return dup;
      }
      return null;
    }
    function run() {
      calls.push({ table, op, payload });
      if (missingTables.has(table)) return err('42P01', `relation "${table}" does not exist`);
      if (opts.failOn && opts.failOn(table, op, payload)) return err('XX000', 'falla simulada');
      db[table] = db[table] || [];
      let rows;
      if (op === 'insert' || op === 'upsert') {
        const list = Array.isArray(payload) ? payload : [payload];
        rows = [];
        for (const p of list) {
          const keys = onConflict ? onConflict.split(',').map((s) => s.trim()) : null;
          const existing = keys ? db[table].find((r) => keys.every((k) => r[k] === p[k])) : null;
          if (op === 'upsert' && existing) { Object.assign(existing, p); rows.push(existing); continue; }
          const row = { id: p.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...p };
          if (checkUnique(row)) return err('23505', 'duplicate key value violates unique constraint');
          db[table].push(row); rows.push(row);
        }
      } else if (op === 'update') {
        rows = db[table].filter(matches);
        for (const r of rows) {
          const next = { ...r, ...payload };
          if (checkUnique(next, r)) return err('23505', 'duplicate key value violates unique constraint');
        }
        rows.forEach((r) => Object.assign(r, payload));
      } else if (op === 'delete') {
        rows = db[table].filter(matches);
        db[table] = db[table].filter((r) => !matches(r));
      } else {
        rows = db[table].filter(matches);
      }
      if (op === 'select' || returning) {
        rows = rows.map((r) => withEmbeds(r, cols));
        if (order) rows = [...rows].sort((a, b) => cmp(a[order.col], b[order.col]) * (order.asc ? 1 : -1));
        const count = rows.length;
        if (lim != null) rows = rows.slice(0, lim);
        if (head) return { data: null, error: null, count };
        if (one === 'single') return rows.length === 1 ? { data: rows[0], error: null, count } : err('PGRST116', 'no rows');
        if (one === 'maybe') return rows.length > 1 ? err('PGRST116', 'multiple rows') : { data: rows[0] || null, error: null, count };
        return { data: rows, error: null, count: countMode ? count : null };
      }
      return { data: null, error: null, count: null };
    }

    const b = {
      select(c = '*', o = {}) { if (op === 'select') cols = c; else returning = true; cols = c; countMode = o.count || null; head = !!o.head; return b; },
      eq(k, v) { filters.push((r) => r[k] === v); return b; },
      neq(k, v) { filters.push((r) => r[k] !== v); return b; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return b; },
      is(k, v) { filters.push((r) => (v === null ? r[k] === null || r[k] === undefined : r[k] === v)); return b; },
      not(k, o, v) {
        if (k.includes('.')) return b;
        if (o === 'is') filters.push((r) => !(v === null ? r[k] == null : r[k] === v));
        else if (o === 'in') { const vals = String(v).replace(/[()"]/g, '').split(','); filters.push((r) => !vals.includes(r[k])); }
        return b;
      },
      gte(k, v) { filters.push((r) => r[k] != null && cmp(r[k], v) >= 0); return b; },
      lte(k, v) { filters.push((r) => r[k] != null && cmp(r[k], v) <= 0); return b; },
      gt(k, v) { filters.push((r) => r[k] != null && cmp(r[k], v) > 0); return b; },
      lt(k, v) { filters.push((r) => r[k] != null && cmp(r[k], v) < 0); return b; },
      ilike(k, p) { const re = ilikeToRegex(p); filters.push((r) => re.test(String(r[k] ?? ''))); return b; },
      or() { return b; },
      order(col, o = {}) { order = { col, asc: o.ascending !== false }; return b; },
      limit(n) { lim = n; return b; },
      range(a, z) { lim = z - a + 1; return b; },
      insert(p) { op = 'insert'; payload = p; return b; },
      upsert(p, o = {}) { op = 'upsert'; payload = p; onConflict = o.onConflict || null; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      single() { one = 'single'; return Promise.resolve(run()); },
      maybeSingle() { one = 'maybe'; return Promise.resolve(run()); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  async function rpc(name, params) {
    calls.push({ rpc: name, params });
    if (name === 'increment_message_count') {
      db.bot_daily_message_counts = db.bot_daily_message_counts || [];
      const row = db.bot_daily_message_counts.find((r) => r.business_id === params.p_business_id && r.client_phone === params.p_client_phone && r.date === params.p_date);
      if (row) row.message_count += 1;
      else db.bot_daily_message_counts.push({ business_id: params.p_business_id, client_phone: params.p_client_phone, date: params.p_date, message_count: 1 });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  return { from, rpc, db, calls };
}

function stub(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', 'src', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// Instala el doble de Supabase, un logger que guarda las líneas y un WhatsApp que guarda los envíos.
function installFakes(fake) {
  const logs = [];
  const sent = [];
  const log = (lvl) => (...a) => logs.push([lvl, ...a]);
  stub('config/supabase', { supabaseAdmin: fake, createUserClient: () => fake });
  stub('utils/logger', { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') });
  stub('config/whatsapp', {
    sendMessage: async (to, text, token, pnid) => { sent.push({ type: 'text', to, text, token, pnid }); return { messages: [{ id: 'wamid.out' }] }; },
    sendTemplate: async (to, name, components, token, pnid) => { sent.push({ type: 'template', to, name, components, token, pnid }); return { messages: [{ id: 'wamid.tpl' }] }; },
  });
  return { logs, sent };
}

// Cliente de Anthropic falso: devuelve las respuestas en orden y guarda cada request
function scriptedAnthropic(responses) {
  const requests = [];
  let i = 0;
  return {
    requests,
    messages: {
      create: async (params) => {
        requests.push(JSON.parse(JSON.stringify(params)));
        const r = typeof responses[i] === 'function' ? responses[i](params) : responses[i];
        i++;
        if (!r) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } };
        return { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...r };
      },
    },
  };
}
const toolUse = (name, input, id = `tu_${name}`) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });

module.exports = { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text };
