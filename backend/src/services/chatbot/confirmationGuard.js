// Guarda contra confirmaciones inventadas del bot.
//
// Bug real: el cliente pidió "prefiero que sea a las 5, me lo cambias?" y el bot respondió "Perfecto, cambio el
// degradado a las 5:00 p. m. ✅" SIN llamar a actualizar_cita: la cita siguió a las 15:00.
//
// Antes de enviar el texto final se mira si afirma haber agendado / cambiado / cancelado una cita y si en ESE
// turno hubo una herramienta de escritura con success=true que lo respalde. Las preguntas ("¿te la cambio a las
// 5?") y los textos informativos ("tu cita es el martes a las 3 ✅") no cuentan como afirmación.

// Herramientas de escritura y qué tipo de afirmación respalda cada una
const WRITE_TOOLS = {
  agendar_cita: ['agendar'],
  actualizar_cita: ['cambiar'],
  cancelar_cita: ['cancelar'],
  gestionar_grupo: ['agendar', 'cambiar', 'cancelar'],
  confirmar_asistencia: [],
  lista_espera: [],
};

const TOOL_FOR = { agendar: 'agendar_cita', cambiar: 'actualizar_cita', cancelar: 'cancelar_cita', generica: 'la herramienta que corresponda' };

const SAFE_TEXT = {
  cambiar: 'Déjame confirmarlo, ¿me repites qué cita quieres cambiar y a qué hora?',
  agendar: 'Déjame confirmarlo, ¿me repites qué servicio, qué día y a qué hora quieres tu cita?',
  cancelar: 'Déjame confirmarlo, ¿me repites qué cita quieres cancelar?',
  generica: 'Déjame confirmarlo, ¿me repites qué necesitas con tu cita y para cuándo?',
};

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Frases (sin tildes) que AFIRMAN haber hecho la acción. Primera persona en pasado o presente de hecho
// ("cambio el degradado a las 5", "te la cancelo"), participios con "quedo/queda/esta" y "ya ...".
const CLAIMS = {
  cancelar: [
    /\b(cancele|he cancelado|ya cancele|te (la |lo )?cancelo|cancelo (tu|la|el)\b)/,
    /\b(quedo|queda|esta|fue) cancelad[ao]\b/,
    /\bcita cancelada\b/,
  ],
  cambiar: [
    /\b(cambie|he cambiado|ya cambie|movi|he movido|reagende|actualice|he actualizado|modifique)\b/,
    /\b(cambio|muevo|paso|reagendo|actualizo) (tu|la|el|tus|las|los|su)\b[^.!?\n]*\b(a las|para el|para las|al)\b/,
    /\b(quedo|queda|esta|fue) (cambiad|movid|reagendad|actualizad|modificad)[ao]\b/,
    /\bahora (es|queda|sera) (a las|el)\b/,
  ],
  agendar: [
    /\b(agende|he agendado|ya agende|reserve|te (deje|dejo) agendad[ao]|te agendo (el|la|para|a las))\b/,
    /\b(quedo|queda|esta|fue) (agendad|reservad|programad)[ao]\b/,
    /\bcita (agendada|reservada|creada)\b/,
  ],
};

// "Listo ✅ Corte agendado": participio + (check o "listo/hecho")
const PARTICIPLES = {
  cancelar: /\bcancelad[ao]s?\b/,
  cambiar: /\b(cambiad|movid|reagendad|actualizad|modificad)[ao]s?\b/,
  agendar: /\b(agendad|reservad|programad)[ao]s?\b/,
};
const DONE_WORDS = /\b(listo|hecho|perfecto)\b/;

const CHECK = /✅|☑️|✔️/;
const ACTION_WORDS = /\b(listo|hecho|perfecto|confirmad[ao]|quedo|queda|lista)\b/;
const DATE_TIME = /\b(a las \d{1,2}(:\d{2})?|\d{1,2}:\d{2})\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/;

// Oraciones afirmativas: se descartan las preguntas (con "?" o "¿")
function affirmativeSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?\n])|(?=¿)/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('?') && !s.includes('¿'));
}

// Devuelve el tipo de afirmación ('agendar' | 'cambiar' | 'cancelar' | 'generica') o null
function detectClaim(text) {
  for (const sentence of affirmativeSentences(text)) {
    const s = norm(sentence);
    for (const tipo of ['cancelar', 'cambiar', 'agendar']) {
      if (CLAIMS[tipo].some((re) => re.test(s))) return tipo;
      if ((CHECK.test(sentence) || DONE_WORDS.test(s)) && PARTICIPLES[tipo].test(s)) return tipo;
    }
    // "Listo ✅ quedó el lunes a las 5": check + palabra de acción + fecha/hora
    if (CHECK.test(sentence) && ACTION_WORDS.test(s) && DATE_TIME.test(s)) return 'generica';
  }
  return null;
}

// writes: [{ name, success }] de las herramientas de escritura ejecutadas en el turno
function isBacked(tipo, writes) {
  const ok = (writes || []).filter((w) => w.success === true);
  if (tipo === 'generica') return ok.length > 0;
  return ok.some((w) => (WRITE_TOOLS[w.name] || []).includes(tipo));
}

function retryInstruction(tipo, writes) {
  const fallo = (writes || []).find((w) => w.success !== true);
  const motivo = fallo
    ? `la herramienta ${fallo.name} devolvió un error, así que NO se hizo`
    : 'en este turno no se ejecutó ninguna herramienta que lo haga';
  return `<nota_del_sistema>Tu respuesta anterior afirmaba que la cita quedó lista, pero ${motivo}. No confirmes nada que no hayas ejecutado. Haz UNA de estas: (1) usa ${TOOL_FOR[tipo]} con el appointment_id de "Citas activas del cliente" y confirma solo si devuelve success=true; (2) si no sabes cuál cita es (por ejemplo, tiene varias del mismo tipo) o falta la hora o el día, pregúntale al cliente; (3) si la herramienta falló, dile que no se pudo y por qué. Responde al cliente, sin mencionar esta nota.</nota_del_sistema>`;
}

module.exports = { WRITE_TOOLS, SAFE_TEXT, detectClaim, isBacked, retryInstruction };
