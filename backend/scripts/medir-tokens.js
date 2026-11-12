#!/usr/bin/env node
// Mide el tamaño (tokens) de los prompts y tools del bot de WhatsApp y del asistente, y estima el costo
// por conversación del bot y por mensaje del asistente con Claude Haiku 4.5.
//
// Uso:  node scripts/medir-tokens.js [--json salida.json] [--sin-api]
//
// Dos métodos, para poder comparar con la auditoría (docs/AUDITORIA_BOT_ASISTENTE_2026-11.md §4):
//   1. "estimado": mismo método de la auditoría → caracteres/3.5 para prosa y caracteres/3 para el JSON de tools,
//      más 496 tokens de overhead por usar tools.
//   2. "real": endpoint count_tokens de Anthropic (gratis, no genera texto). Solo si hay ANTHROPIC_API_KEY.
//      Se le envían únicamente los prompts y tools con datos de EJEMPLO (negocio ficticio), nunca datos reales.
//
// No consulta la base de datos: los módulos de Supabase y logger se reemplazan por dobles vacíos.

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const useApi = !args.includes('--sin-api') && !!process.env.ANTHROPIC_API_KEY;

// ── Dobles de Supabase y logger (no se toca la base) ────────────────────────────────────────────────
function stubModule(rel, exports) {
  const p = require.resolve(path.join('..', 'src', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
const noopQuery = () => { const b = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : () => b) }); return b; };
stubModule('config/supabase', { supabaseAdmin: { from: noopQuery, rpc: async () => ({}) }, createUserClient: () => ({ from: noopQuery }) });
stubModule('utils/logger', { info() {}, warn() {}, error() {}, debug() {} });

const MODEL = 'claude-haiku-4-5-20251001';
const PRICE = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }; // USD por millón (Haiku 4.5)
const TOOLS_OVERHEAD = 496; // tokens que agrega la API cuando hay tools (tool_choice auto)
const COP_PER_USD = 3250;   // mismo supuesto de la auditoría

// ── Negocio de ejemplo (igual al de la auditoría: 10 servicios, 1 cita activa) ───────────────────────
const business = { id: '00000000-0000-0000-0000-000000000001', name: 'Barbería Ejemplo', business_type: 'barberia', whatsapp_phone_number_id: '0', plan: 'pro' };
const services = [
  ['Corte clásico', 25000, 30], ['Corte + barba', 35000, 45], ['Corte niño', 20000, 30], ['Barba', 15000, 20],
  ['Afeitado tradicional', 18000, 30], ['Cejas', 8000, 15], ['Tinte', 45000, 60], ['Keratina', 90000, 90],
  ['Mascarilla', 20000, 20], ['Diseño de barba', 22000, 30],
].map(([name, price, duration_minutes]) => ({ name, price, duration_minutes }));
const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '19:00', is_open: d !== 0 }));
const citas = [{ id: '11111111-2222-3333-4444-555555555555', scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString(), status: 'confirmed', services: { name: 'Corte clásico' }, employees: { name: 'Carlos' } }];
const clientInfo = { name: 'Juan Pérez' };

// ── Extraer lo que manda cada flujo a Claude ─────────────────────────────────────────────────────────
function extractArrayLiteral(src, marker) {
  // Para la versión antigua del bot, donde las tools vivían dentro de processChatbotMessage
  const i = src.indexOf(marker);
  if (i < 0) return null;
  let j = src.indexOf('[', i); let depth = 0; let k = j;
  for (; k < src.length; k++) { if (src[k] === '[') depth++; else if (src[k] === ']') { depth--; if (depth === 0) break; } }
  // eslint-disable-next-line no-new-func
  return Function(`return ${src.slice(j, k + 1)};`)();
}

function botRequest() {
  const chatbot = require('../src/services/chatbot.service');
  if (typeof chatbot.buildBotRequest === 'function') {
    // Versión nueva: la misma función que usa producción arma system + tools
    const r = chatbot.buildBotRequest({ business, clientInfo, businessHours: hours, services, citasActivas: citas });
    return { system: r.system, tools: r.tools, version: 'nueva', volatile: r.volatileText || '' };
  }
  const { staticPrompt, dynamicPrompt } = chatbot.getBusinessSystemPrompt(business, clientInfo, hours, services, citas);
  const src = fs.readFileSync(require.resolve('../src/services/chatbot.service'), 'utf8');
  const tools = extractArrayLiteral(src, 'const tools = [');
  return {
    system: [{ type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } }, { type: 'text', text: dynamicPrompt }],
    tools, version: 'antigua', volatile: '',
  };
}

function assistantRequests() {
  const a = require('../src/services/assistant.service');
  const sampleBiz = '<biz>\nN:Barbería Ejemplo|T:barberia|P:pro|Clientes:120\nDir:Calle 1|Tel:3000000000|País:Colombia\nHorarios:Lun:09:00-19:00 | Mar:09:00-19:00\nHoy(2026-11-11)-Citas:09:00 AM Juan/Corte[confirmed]; 10:00 AM Ana/Barba[pending]\nIngresos hoy:$120.000 | Mes:$2.300.000 (sin meta)\n</biz>\n<fecha_actual>\nFECHA Y HORA ACTUAL: martes, 11 de noviembre de 2026, 10:15\nFECHA ISO HOY: 2026-11-11\n</fecha_actual>';
  if (typeof a.buildAssistantRequest === 'function') {
    // Versión nueva: tools y prompt según el dominio del mensaje
    const casos = {
      'agenda ("cita para Juan mañana a las 3")': 'cita para Juan mañana a las 3 corte clásico',
      'caja ("registra un gasto de 50 mil")': 'registra un gasto de 50 mil en arriendo',
      'analítica ("¿cómo voy este mes?")': '¿cómo voy este mes?',
      'cliente + cita (2 dominios)': 'crea el cliente Pedro Gómez y agéndale un corte mañana a las 4',
    };
    return Object.entries(casos).map(([label, msg]) => {
      const r = a.buildAssistantRequest({ userMessage: msg, history: [], volatileText: sampleBiz });
      return { label, system: r.system, tools: r.tools, domains: r.domains, volatile: sampleBiz };
    });
  }
  return [{
    label: 'todas las tools (versión antigua)',
    system: [{ type: 'text', text: a.SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }, { type: 'text', text: sampleBiz }],
    tools: a.tools,
  }];
}

// ── Conteo ───────────────────────────────────────────────────────────────────────────────────────────
const sysText = (system) => system.map((b) => b.text).join('\n');
function estimate({ system, tools }) {
  const staticChars = system.filter((b, i) => i === 0).map((b) => b.text.length).reduce((a, b) => a + b, 0);
  const restChars = system.slice(1).map((b) => b.text.length).reduce((a, b) => a + b, 0);
  const toolChars = JSON.stringify(tools || []).length;
  return {
    static: Math.round(staticChars / 3.5),
    resto_system: Math.round(restChars / 3.5),
    tools: Math.round(toolChars / 3) + (tools?.length ? TOOLS_OVERHEAD : 0),
  };
}

let Anthropic; let client;
async function countReal(params) {
  if (!useApi) return null;
  if (!client) { Anthropic = require('@anthropic-ai/sdk'); client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 }); }
  const r = await client.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: 'hola' }], ...params });
  return r.input_tokens;
}
async function real({ system, tools }) {
  if (!useApi) return null;
  try {
    const base = await countReal({});
    const conTools = await countReal({ tools });
    const soloStatic = await countReal({ tools, system: [system[0]] });
    const todo = await countReal({ tools, system });
    return { tools: conTools - base, static: soloStatic - conTools, resto_system: todo - soloStatic, prefijo_total: todo - base };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Modelo de costo ──────────────────────────────────────────────────────────────────────────────────
// Supuestos de la auditoría (§4.3): usuario 40 tokens, respuesta 70, resultado de tool 180, salida por llamada 70
// (con tool_use ≈ 60). Una "llamada" = un messages.create. Caché caliente = el prefijo compartido ya está escrito.
const U = 40; const A = 70; const TR = 180; const OUT = 70;
const cost = (t) => (t.in * PRICE.input + t.out * PRICE.output + t.cw * PRICE.cacheWrite + t.cr * PRICE.cacheRead) / 1e6;

// Cada turno: número de tools que dispara (llamadas = tools + 1)
const CONV = {
  antes: { tipica: [0, 1, 0, 1, 0], pesada: [1, 1, 0, 1, 1, 0] },        // auditoría: 7 y 10 llamadas
  despues: { tipica: [0, 1, 0, 1, 0], pesada: [0, 1, 0, 0, 1] },        // sin ver_servicios forzado y nombre pedido antes de agendar
};

function simulate({ prefix, business: biz, volatile, scheme, turns, warm }) {
  // scheme 'antes': bp en el estático; todo lo demás (dinámico + historial) sin caché.
  // scheme 'despues': bp1 estático, bp2 bloque del negocio, bp3 último texto del usuario, bp4 último tool_result;
  //                   lo volátil va al final del último mensaje.
  const t = { in: 0, out: 0, cw: 0, cr: 0, calls: 0 };
  let hist = 0; let firstCall = true;
  let prevUserBp = 0; // tokens de mensajes cubiertos por el breakpoint del texto del usuario del turno anterior
  for (const nTools of turns) {
    hist += U;
    let loop = 0; let cachedInTurn = 0;
    for (let c = 0; c <= nTools; c++) {
      t.calls++;
      if (firstCall && !warm) t.cw += prefix; else t.cr += prefix;
      if (scheme === 'antes') {
        t.in += biz + volatile + hist + loop;
      } else {
        if (firstCall) t.cw += biz; else t.cr += biz; // bloque estable del negocio (bp2): 1 escritura por conversación
        if (c === 0) {
          // bp3 en el texto del usuario: se lee el historial ya cacheado y se escribe lo nuevo; el volátil va sin caché
          t.cr += prevUserBp; t.cw += hist - prevUserBp; t.in += volatile;
          prevUserBp = hist; cachedInTurn = hist;
        } else {
          // bp4 en el último tool_result: incluye el volátil y el loop; lo anterior se lee
          const content = hist + volatile + loop;
          t.cr += cachedInTurn; t.cw += content - cachedInTurn; cachedInTurn = content;
        }
      }
      firstCall = false;
      t.out += c < nTools ? 60 : OUT;
      if (c < nTools) loop += 60 + TR;
    }
    hist += A;
  }
  return { ...t, usd: cost(t) };
}

(async () => {
  const out = { fecha: new Date().toISOString(), metodo_api: useApi ? 'count_tokens' : 'solo estimado', bot: {}, asistente: [] };

  // Bot
  const b = botRequest();
  const est = estimate(b);
  const re = await real(b);
  out.bot = { version: b.version, num_tools: b.tools.length, estimado: est, real: re, chars: { system: b.system.map((x) => x.text.length), tools_json: JSON.stringify(b.tools).length } };

  const pick = (k) => (re && !re.error ? re[k] : est[k]);
  // Prefijo cacheado y bloque del negocio según la versión
  let prefix; let biz; let volatile;
  if (b.version === 'antigua') {
    prefix = pick('tools') + pick('static');
    biz = 0; volatile = pick('resto_system'); // todo el dinámico iba sin caché
  } else {
    prefix = pick('tools') + pick('static');
    biz = pick('resto_system');
    volatile = re && !re.error && useApi ? (await countReal({ messages: [{ role: 'user', content: b.volatile || 'x' }] })) - 3 : Math.round((b.volatile || '').length / 3.5);
  }
  out.bot.prefijo_cacheable = prefix;
  out.bot.bloque_negocio = biz;
  out.bot.volatil = volatile;
  out.bot.cacheable_min_4096 = prefix >= 4096 ? 'sí (compartido entre negocios)' : (prefix + biz >= 4096 ? 'solo con el bloque del negocio' : 'NO');
  const scheme = b.version === 'antigua' ? 'antes' : 'despues';
  const conv = CONV[scheme];
  out.bot.costo = {};
  for (const [nombre, turns] of Object.entries(conv)) {
    for (const warm of [true, false]) {
      const r = simulate({ prefix, business: biz, volatile, scheme, turns, warm });
      out.bot.costo[`${nombre}_${warm ? 'caliente' : 'frio'}`] = { llamadas: r.calls, usd: +r.usd.toFixed(5), cop: Math.round(r.usd * COP_PER_USD) };
    }
  }

  // Asistente
  for (const req of assistantRequests()) {
    const e = estimate(req);
    const r = await real(req);
    const pre = (r && !r.error) ? r.tools + r.static : e.tools + e.static;
    // El contexto del negocio: antes iba en el system (resto_system); ahora va al final del mensaje (volatile)
    const dyn = req.volatile
      ? (useApi ? (await countReal({ messages: [{ role: 'user', content: req.volatile }] })) - 3 : Math.round(req.volatile.length / 3.5))
      : ((r && !r.error) ? r.resto_system : e.resto_system);
    // Mensaje típico del asistente: 2 llamadas (1 tool con resultado de 400 tokens), historial 400, salida 150
    const callsCases = { consulta_1_tool: 2, crear_cita_3_tools: 4 };
    const costos = {};
    for (const [k, calls] of Object.entries(callsCases)) {
      for (const warm of [true, false]) {
        const t = { in: 0, out: 0, cw: 0, cr: 0 };
        let loop = 0;
        for (let c = 0; c < calls; c++) {
          if (c === 0 && !warm) t.cw += pre; else t.cr += pre;
          if (b.version === 'antigua') t.in += dyn + 400 + 40 + loop;
          else if (c === 0) { t.cw += 400 + 40; t.in += dyn; } else { t.cr += 440; t.cw += dyn + (c === 1 ? loop : 460); }
          t.out += c < calls - 1 ? 60 : 150;
          loop += 460;
        }
        costos[`${k}_${warm ? 'caliente' : 'frio'}`] = { usd: +cost(t).toFixed(5), cop: Math.round(cost(t) * COP_PER_USD) };
      }
    }
    out.asistente.push({ caso: req.label, dominios: req.domains, num_tools: req.tools.length, estimado: e, real: r, prefijo_cacheable: pre, cacheable_min_4096: pre >= 4096 ? 'sí' : 'NO', costo: costos });
  }

  const txt = JSON.stringify(out, null, 2);
  if (jsonOut) fs.writeFileSync(jsonOut, txt);
  console.log(txt);
})();
