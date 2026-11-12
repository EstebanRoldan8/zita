const { sendMessage } = require('../config/whatsapp');
const { supabaseAdmin } = require('../config/supabase');
const { decrypt } = require('../utils/encrypt');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const {
  getAvailableEmployee, loadDay, checkHours, freeEmployees, freeSlots, isEmployeeFree,
  isValidDate, normalizeTime, toInstantMs, localParts, localISO, todayLocal, DEFAULT_DURATION,
} = require('../utils/availability');
const { isPlanExpired } = require('../utils/planStatus');
const { deleteCitaIncome } = require('./scheduler.service');
const { logSystemAlert } = require('../utils/systemAlerts');
const { getPlan } = require('../config/plans');
const { maskPhone } = require('../utils/phone');
const { notify } = require('./whatsappNotify');
const { buildBotRequest } = require('./chatbot/prompt');
const { convKey, newRequestId } = require('../utils/aiUsage');

// Modelo y límites del bot. max_tokens es solo un tope (no cambia el costo): 600 alcanza para una lista de servicios.
const BOT_MODEL = 'claude-haiku-4-5-20251001';
const BOT_MAX_TOKENS = 600;
const BOT_MAX_TOOL_ITERATIONS = 5;  // hasta 6 llamadas por mensaje; lo normal es 1-2
const HISTORY_MAX = 12;             // mensajes de historial que se mandan como máximo…
const HISTORY_KEEP = 6;             // …y al pasarse se recorta a estos (en bloque, para no romper el caché)

// Desde qué número se avisa al dueño: el del negocio con su token; si el negocio no tiene token, el número
// global de ZITA (token y número globales juntos: mezclar el token global con el número del negocio falla).
function ownerSender(business) {
  if (business?.whatsapp_access_token && business?.whatsapp_phone_number_id) {
    return { token: decrypt(business.whatsapp_access_token), phoneNumberId: business.whatsapp_phone_number_id };
  }
  return { token: null, phoneNumberId: null };
}
const { loadConversation, saveMessages, pendingReminder } = require('./conversationStore');

// Respuestas exactas a un recordatorio (solo se usan si lo último que mandó el bot fue el recordatorio)
const CONFIRM_WORDS = new Set(['si', 'sí', 'confirmo', 'confirmado', 'ahí estaré', 'ahi estare', 'voy', 'allá voy', 'alla voy', 'por supuesto', 'si voy', 'sí voy', 'confirmar']);
const CANCEL_WORDS = new Set(['no', 'no puedo', 'cancela', 'cancelar', 'no voy', 'no puedo ir', 'no iré', 'no ire', 'cancela mi cita', 'no asisto']);
const { callClaudeWithRetry } = require('../utils/anthropicRetry');
const Groq = require('groq-sdk');

// Un solo cliente de Anthropic por proceso. maxRetries: 0 porque los reintentos los hace callClaudeWithRetry
// (si no, el SDK reintenta 2 veces dentro de cada intento del wrapper: hasta 9 llamadas).
let anthropicClientSingleton = null;
function getAnthropicClient() {
  if (!anthropicClientSingleton) {
    anthropicClientSingleton = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30 * 1000, maxRetries: 0 });
  }
  return anthropicClientSingleton;
}
// Solo para tests: inyecta un cliente falso
function __setAnthropicClientForTests(c) { anthropicClientSingleton = c; }

// Escapa comodines de ILIKE (% _ \) para que un texto del cliente no haga match con cualquier registro
function escapeLike(s) {
  return String(s || '').trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Busca un servicio activo por nombre: primero coincidencia exacta (sin tildes ni mayúsculas), luego parcial.
// Si la parcial da varios, devuelve ambiguo con las opciones en vez de elegir uno al azar.
async function findService(businessId, name) {
  const term = normName(name);
  if (!term) return { servicio: null };
  const { data } = await supabaseAdmin
    .from('services')
    .select('id, name, price, duration_minutes')
    .eq('business_id', businessId)
    .eq('active', true)
    .ilike('name', `%${escapeLike(name)}%`)
    .limit(10);
  const list = data || [];
  const exact = list.filter((s) => normName(s.name) === term);
  if (exact.length >= 1) return { servicio: exact[0] };
  if (list.length === 1) return { servicio: list[0] };
  if (list.length > 1) return { servicio: null, ambiguo: true, opciones: list.map((s) => ({ name: s.name, price: s.price, duration_minutes: s.duration_minutes })) };
  return { servicio: null };
}

// Códigos de Postgres que indican que el horario ya se tomó (único por inicio o exclusión por solape)
const isBookingConflict = (error) => error && (error.code === '23505' || error.code === '23P01');

// Cache de horarios por negocio (5 minutos)
const businessHoursCache = new Map();
const HOURS_CACHE_TTL = 1 * 60 * 1000;

function getCachedHours(businessId) {
  const cached = businessHoursCache.get(businessId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > HOURS_CACHE_TTL) {
    businessHoursCache.delete(businessId);
    return null;
  }
  return cached.hours;
}

function setCachedHours(businessId, hours) {
  businessHoursCache.set(businessId, { hours, timestamp: Date.now() });
  if (businessHoursCache.size > 100) {
    const oldest = [...businessHoursCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) businessHoursCache.delete(oldest[0]);
  }
}

async function transcribeAudio(audioUrl, accessToken) {
  try {
    const audioResponse = await fetch(audioUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000)
    });

    if (!audioResponse.ok) {
      logger.error('AUDIO_DOWNLOAD_FAIL_' + audioResponse.status);
      return null;
    }
    // Notas de voz de WhatsApp: máx. 16 MB. Más que eso no se descarga ni se transcribe (costo y memoria)
    const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
    if (Number(audioResponse.headers.get('content-length') || 0) > MAX_AUDIO_BYTES) {
      logger.warn('AUDIO_DEMASIADO_GRANDE');
      return null;
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    logger.info('AUDIO_OK_BYTES_' + audioBuffer.length + '_GROQKEY_' + (process.env.GROQ_API_KEY ? 'SET' : 'MISSING'));

    const FormData = require('form-data');
    const axios = require('axios');

    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'es');
    form.append('response_format', 'text');

    const groqResponse = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          ...form.getHeaders()
        },
        timeout: 20000,
        maxBodyLength: 25 * 1024 * 1024, // límite de Groq
        maxContentLength: 1024 * 1024
      }
    );

    const transcribedText = groqResponse.data;
    logger.info('TRANSCRIPCION_OK', { length: String(transcribedText).length }); // nunca el texto (PII)
    return typeof transcribedText === 'string' ? transcribedText.trim() : null;

  } catch (err) {
    const errMsg = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 200)
      : err.message;
    logger.error('GROQ_FAIL_' + errMsg.replace(/\s+/g, '_'));
    return null;
  }
}

// El prompt y las tools del bot viven en ./chatbot/prompt.js (organizados para el caché de prompts)

async function getBusinessByPhoneNumberId(phoneNumberId) {
  const { data, error } = await supabaseAdmin
    .from('businesses')
    .select('id, name, business_type, plan, whatsapp_phone_number_id, whatsapp_access_token, status, trial_ends_at, plan_expires_at, phone, owner_email')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .single();
  if (error) {
    logger.error('Error buscando business por phoneNumberId:', { phoneNumberId, error: error.message });
  }
  return data;
}

// Notifica al dueño del negocio que su plan/trial expiró y un cliente le está
// escribiendo. Máximo una notificación cada 24h (por WhatsApp + email).
// La columna last_trial_expiry_notification se consulta aparte (no en
// getBusinessByPhoneNumberId) para que, si la migración 039 todavía no se
// aplicó en la base de datos, el bot no se caiga por completo — en el peor
// caso, solo se pierde el throttle de 24h y se notifica más seguido.
async function notifyOwnerPlanExpired(business) {
  try {
    const ahora = new Date();
    let ultimaNotif = null;
    try {
      const { data: notifData } = await supabaseAdmin
        .from('businesses')
        .select('last_trial_expiry_notification')
        .eq('id', business.id)
        .single();
      if (notifData?.last_trial_expiry_notification) {
        ultimaNotif = new Date(notifData.last_trial_expiry_notification);
      }
    } catch (colErr) {
      logger.error('Columna last_trial_expiry_notification no disponible (¿falta migración 039?): ' + colErr.message);
    }
    const yaNotificado24h = ultimaNotif && (ahora - ultimaNotif) < 24 * 60 * 60 * 1000;
    if (yaNotificado24h) return;

    const mensajeDueno = '⚠️ Tu plan ZITA expiró y un cliente te está escribiendo. Renueva para seguir atendiendo por WhatsApp.';

    if (business.phone) {
      // Aviso al dueño: casi siempre fuera de la ventana de 24 h → plantilla plan_vencido (si están activas)
      const { token, phoneNumberId } = ownerSender(business);
      await notify({ to: business.phone, text: mensajeDueno, template: { key: 'plan_vencido', body: [business.name] }, token, phoneNumberId, businessId: business.id });
    }

    if (business.owner_email) {
      try {
        const resend = require('../config/resend');
        await resend.emails.send({
          from: 'ZITA <onboarding@resend.dev>',
          to: business.owner_email,
          subject: 'Tu plan ZITA expiró — un cliente te está escribiendo',
          html: `<h2>Tu plan ZITA expiró</h2><p>Un cliente le escribió a <b>${business.name}</b> por WhatsApp, pero no se le pudo responder porque el plan/trial está vencido.</p><p>Renueva tu plan para seguir atendiendo a tus clientes por WhatsApp.</p>`,
        });
      } catch (emailErr) {
        logger.error('Error enviando email de trial expirado: ' + emailErr.message);
      }
    }

    await supabaseAdmin
      .from('businesses')
      .update({ last_trial_expiry_notification: ahora.toISOString() })
      .eq('id', business.id);
  } catch (err) {
    logger.error('Error notificando dueño de plan expirado: ' + err.message);
  }
}


async function getOrCreateClient(businessId, phone, name = null) {
  const { data: existingArr } = await supabaseAdmin
    .from('clients')
    .select('id, name, archived')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .limit(1);

  const existing = existingArr?.[0] || null;

  if (existing) {
    // Si el cliente está archivado, reactivarlo (volvió a escribir)
    if (existing.archived) {
      const { data: reactivated } = await supabaseAdmin
        .from('clients')
        .update({ archived: false })
        .eq('id', existing.id)
        .select('id, name')
        .single();
      return reactivated || existing;
    }
    return existing;
  }

  const { data: newClient, error: newClientError } = await supabaseAdmin
    .from('clients')
    .insert({
      business_id: businessId,
      phone: phone,
      name: name || 'Cliente WhatsApp'
    })
    .select('id, name')
    .single();

  // Caso normal: cliente creado exitosamente
  if (!newClientError) {
    return newClient || null;
  }

  // Race condition: otro proceso creó el cliente casi simultáneamente (UNIQUE violation)
  if (newClientError.code === '23505') {
    logger.info('[GET_OR_CREATE_CLIENT_UNIQUE_COLLISION]', { businessId, phone: maskPhone(phone) });
    const { data: recoveredArr } = await supabaseAdmin
      .from('clients')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .limit(1);
    return recoveredArr?.[0] || null;
  }

  // Error genuino (no UNIQUE violation)
  logger.warn('[GET_OR_CREATE_CLIENT_INSERT_FAILED]', { businessId, phone, error: newClientError?.message });
  return null;
}

async function getConversationHistory(businessId, clientPhone) {
  const conv = await loadConversation(businessId, clientPhone);
  return conv?.messages || [];
}

// Guarda solo texto (sin bloques de tools ni delimitadores), conservando timestamps y la marca de recordatorio
async function saveConversationHistory(businessId, clientPhone, messages) {
  await saveMessages(businessId, clientPhone, messages);
}

async function incrementDailyMessageCount(businessId, clientPhone) {
  const hoyColombia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  // Intenta INSERT; si existe, actualiza con +1
  const { error } = await supabaseAdmin.rpc('increment_message_count', {
    p_business_id: businessId,
    p_client_phone: clientPhone,
    p_date: hoyColombia
  });

  if (error) {
    logger.error('Error incrementando contador diario:', { businessId, phone: maskPhone(clientPhone), error: error.message });
  }
}

async function processChatbotMessage(businessId, clientPhone, messageText, history, business, clientInfo = null) {
  logger.info('Procesando mensaje del chatbot', { businessId, phone: maskPhone(clientPhone), messageLength: messageText.length, historyLength: history.length });

  let businessHours = getCachedHours(businessId);
  if (!businessHours) {
    const { data: hoursData } = await supabaseAdmin
      .from('business_hours')
      .select('day_of_week, open_time, close_time, is_open')
      .eq('business_id', businessId)
      .order('day_of_week');
    businessHours = hoursData;
    if (hoursData) setCachedHours(businessId, hoursData);
  }

  let services = null;
  const { data: servicesData } = await supabaseAdmin
    .from('services')
    .select('name, price, duration_minutes')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');
  services = servicesData;

  let citasActivas = [];
  try {
    const { data: clienteParaCitas } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', clientPhone)
      .single();

    if (clienteParaCitas) {
      const { data: citasData, error: citasError } = await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, services(name), employees(name)')
        .eq('business_id', businessId)
        .eq('client_id', clienteParaCitas.id)
        .in('status', ['pending', 'confirmed'])
        .order('scheduled_at', { ascending: true })
        .limit(10);

      if (citasError) {
        logger.error('Error consultando citas activas del cliente:', citasError.message);
      } else {
        citasActivas = citasData || [];
      }
    }
  } catch (err) {
    logger.error('Error inesperado consultando citas activas del cliente:', err.message);
    citasActivas = [];
  }

  const anthropicClient = getAnthropicClient();
  const botRequest = buildBotRequest({ business, clientInfo, businessHours: businessHours || [], services: services || [], citasActivas });

  // La cita debe ser del negocio Y del cliente que escribe (identificado por su teléfono). Nunca se confía en el
  // appointment_id que mande el modelo: puede venir de un prompt injection o de otra conversación.
  async function citaDelCliente(appointmentId, cols = 'id, scheduled_at, status, employee_id, service_id, services(name, price, duration_minutes)') {
    if (!UUID_RE.test(String(appointmentId || ''))) return null;
    const { data: cli } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', clientPhone)
      .limit(1);
    const clientId = cli?.[0]?.id;
    if (!clientId) return null;
    const { data } = await supabaseAdmin
      .from('appointments')
      .select(cols)
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .eq('client_id', clientId)
      .maybeSingle();
    return data || null;
  }
  const CITA_NO_ENCONTRADA = { success: false, error: 'No encontré esa cita entre tus citas. Revisa la lista de citas activas.' };

  async function executeChatbotTool(toolName, toolInput) {
    try {
      switch(toolName) {
        case 'ver_servicios': {
          const { data } = await supabaseAdmin
            .from('services')
            .select('name, price, duration_minutes')
            .eq('business_id', businessId)
            .eq('active', true)
            .order('name');

          const unicos = [];
          const nombres = new Set();
          data?.forEach(s => {
            if (!nombres.has(s.name)) {
              nombres.add(s.name);
              unicos.push(s);
            }
          });

          return { servicios: unicos };
        }

        case 'verificar_disponibilidad': {
          const fecha = String(toolInput.fecha || '').trim();
          if (!isValidDate(fecha)) return { disponible: false, error: 'fecha_invalida', mensaje: 'Fecha inválida. Usa YYYY-MM-DD.' };
          if (fecha < todayLocal()) return { disponible: false, mensaje: 'Esa fecha ya pasó.' };

          // La duración del servicio decide si la cita cabe (un servicio de 60 min no cabe en un hueco de 30)
          let durMin = DEFAULT_DURATION;
          let servicioUsado = null;
          if (toolInput.service_name) {
            const found = await findService(businessId, toolInput.service_name);
            if (found.servicio) { durMin = found.servicio.duration_minutes || DEFAULT_DURATION; servicioUsado = found.servicio.name; }
          }

          const day = await loadDay(businessId, fecha);
          if (day.cerrado) {
            return { disponible: false, cerrado: true, festivo: true, razon: day.cerrado.reason, mensaje: `Ese dia estamos cerrados: ${day.cerrado.reason}` };
          }
          if (!day.horario?.is_open) return { disponible: false, cerrado: true, mensaje: 'El negocio está cerrado ese día' };
          if (!day.empleados.length) return { disponible: false, mensaje: 'No hay empleados disponibles' };
          const horario = `${normalizeTime(day.horario.open_time)} a ${normalizeTime(day.horario.close_time)}`;

          if (toolInput.hora) {
            const hora = normalizeTime(toolInput.hora);
            if (!hora) return { disponible: false, error: 'hora_invalida', mensaje: 'Hora inválida. Usa HH:mm (24 horas).' };
            const fit = checkHours(day, hora, durMin);
            if (!fit.valid) return { disponible: false, fuera_horario: true, mensaje: fit.reason };
            if (toInstantMs(fecha, hora) <= Date.now()) {
              return { disponible: false, mensaje: 'Esa hora ya pasó.', slots_alternativos: freeSlots(day, durMin, { limit: 3 }) };
            }
            if (freeEmployees(day, hora, durMin).length) {
              return { disponible: true, fecha, hora, duracion_min: durMin, servicio: servicioUsado };
            }
            const alternativas = freeSlots(day, durMin, { after: hora, limit: 3 });
            return {
              disponible: false,
              slots_alternativos: alternativas,
              mensaje: alternativas.length ? `Ese horario está ocupado. Alternativas: ${alternativas.join(', ')}` : 'No quedan horarios libres ese día después de esa hora.'
            };
          }

          const libres = freeSlots(day, durMin);
          return {
            disponible: libres.length > 0,
            horario,
            duracion_min: durMin,
            servicio: servicioUsado,
            horas_disponibles: libres,
            mensaje: libres.length > 0 ? `Hay ${libres.length} horarios libres` : 'No hay disponibilidad ese día'
          };
        }

        case 'agendar_cita': {
          const fecha = String(toolInput.fecha || '').trim();
          const hora = normalizeTime(toolInput.hora);
          if (!isValidDate(fecha)) return { success: false, error: 'Fecha inválida. Usa YYYY-MM-DD.' };
          if (!hora) return { success: false, error: 'Hora inválida. Usa HH:mm (24 horas).' };
          toolInput.fecha = fecha;
          toolInput.hora = hora;

          const found = await findService(businessId, toolInput.service_name);
          if (found.ambiguo) return { success: false, error: 'servicio_ambiguo', opciones: found.opciones };
          const servicio = found.servicio;
          if (!servicio) return { success: false, error: 'Servicio no encontrado' };
          const durMin = servicio.duration_minutes || DEFAULT_DURATION;

          const day = await loadDay(businessId, fecha);
          const horarioValido = checkHours(day, hora, durMin);
          if (!horarioValido.valid) {
            return { success: false, error: horarioValido.reason };
          }

          // La hora no puede haber pasado
          if (toInstantMs(fecha, hora) <= Date.now()) {
            const horaActual = localParts(new Date()).hora;
            return {
              success: false,
              error: `Esa hora ya pasó. Puedes agendar desde las ${horaActual} en adelante.`
            };
          }

          // Si el cliente pidió un empleado específico, intentar asignarlo
          let empleadoDisponible = null;
          if (toolInput.employee_name) {
            const { data: empMatches } = await supabaseAdmin
              .from('employees')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .ilike('name', `%${escapeLike(toolInput.employee_name)}%`);

            // Si hay 2+ matches, retorna error de ambigüedad
            if (empMatches && empMatches.length > 1) {
              return {
                success: false,
                error: 'empleado_ambiguo',
                opciones: empMatches.map(e => ({ name: e.name }))
              };
            }

            const empPref = empMatches && empMatches.length === 1 ? empMatches[0] : null;
            if (empPref) {
              if (isEmployeeFree(day, empPref.id, hora, durMin)) {
                empleadoDisponible = empPref;
              } else {
                const alternativasEmp = freeSlots({ ...day, empleados: [empPref] }, durMin, { after: hora, limit: 3 });
                return {
                  success: false,
                  error: `${empPref.name} no está disponible a esa hora. ¿Quieres con otro empleado disponible?`,
                  slots_alternativos_con_empleado: alternativasEmp
                };
              }
            }
          }

          if (!empleadoDisponible) {
            empleadoDisponible = await getAvailableEmployee(businessId, fecha, hora, durMin, { day });
          }
          if (!empleadoDisponible) {
            // Nadie disponible: ofrece las siguientes horas libres ese mismo día (para la duración de este servicio)
            const slotsLibres = freeSlots(day, durMin, { after: hora, limit: 3 });
            return {
              success: false,
              error: 'sin_disponibilidad',
              slots_alternativos: slotsLibres,
              mensaje: slotsLibres.length > 0
                ? `No hay disponibilidad a las ${hora}. Alternativas: ${slotsLibres.join(', ')}`
                : 'No hay disponibilidad ese día.'
            };
          }

          let { data: clienteExistente } = await supabaseAdmin
            .from('clients')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('phone', clientPhone)
            .maybeSingle();

          // Guardia en servidor: no se agenda sin nombre real del cliente.
          // El LLM puede ignorar el prompt; esto no.
          const nombreActualCliente = clienteExistente?.name?.trim();
          const sinNombreReal = !nombreActualCliente || nombreActualCliente === 'Cliente WhatsApp';
          const nombreEnviado = (toolInput.client_name || '').trim();
          if (sinNombreReal && !nombreEnviado) {
            return {
              success: false,
              error: 'falta_nombre_cliente',
              mensaje: 'Antes de agendar necesitas el nombre del cliente. Pídeselo ("¿A qué nombre te agendo?") y vuelve a llamar agendar_cita con client_name.'
            };
          }
          if (nombreEnviado) {
            // Mayúscula inicial en cada palabra (regla de nombres)
            toolInput.client_name = nombreEnviado
              .toLowerCase()
              .replace(/(^|\s)(\p{L})/gu, (_, sp, ch) => sp + ch.toUpperCase());
          }

          // En WhatsApp la identidad del cliente es su teléfono: nunca se busca "por nombre" (eso le ponía la cita
          // a otra persona con nombre parecido y el recordatorio le llegaba a ella).

          if (!clienteExistente) {
            const { data: nuevoCliente, error: nuevoClienteError } = await supabaseAdmin
              .from('clients')
              .insert({
                business_id: businessId,
                name: toolInput.client_name || 'Cliente WhatsApp',
                phone: clientPhone
              })
              .select('id, name')
              .single();

            if (nuevoClienteError || !nuevoCliente) {
              logger.warn('[AGENDAR_CITA_CLIENT_INSERT_FAILED]', { businessId, phone: maskPhone(clientPhone), error: nuevoClienteError?.message });
              return { success: false, error: 'No se pudo registrar el cliente para agendar la cita' };
            }
            clienteExistente = nuevoCliente;
          } else if (toolInput.client_name && clienteExistente.name === 'Cliente WhatsApp') {
            await supabaseAdmin
              .from('clients')
              .update({ name: toolInput.client_name })
              .eq('id', clienteExistente.id);
            clienteExistente.name = toolInput.client_name;
            if (clientInfo && toolInput.client_name) {
              clientInfo.name = toolInput.client_name;
            }
          }

          const scheduled_at = `${toolInput.fecha}T${toolInput.hora}:00-05:00`;

          // Validar límite de citas del mes
          const { data: bizPlan } = await supabaseAdmin
            .from('businesses')
            .select('plan')
            .eq('id', businessId)
            .single();

          const limitebot = getPlan(bizPlan?.plan).max_appointments_month;

          if (limitebot !== -1) {
            const _tzbot = require('../utils/timezone').getTimezone();
            const _offbot = require('../utils/timezone').getOffsetForTz(_tzbot);
            const mesActualbot = new Date().toLocaleDateString('en-CA', { timeZone: _tzbot }).slice(0, 7);
            const inicioMesbot = `${mesActualbot}-01T00:00:00${_offbot}`;
            const [yrbot, mobot] = mesActualbot.split('-').map(Number);
            const ultimoDiabot = new Date(yrbot, mobot, 0).getDate();
            const finMesbot = `${mesActualbot}-${String(ultimoDiabot).padStart(2, '0')}T23:59:59${_offbot}`;

            const { count: countbot } = await supabaseAdmin
              .from('appointments')
              .select('id', { count: 'exact', head: true })
              .eq('business_id', businessId)
              .gte('scheduled_at', inicioMesbot)
              .lte('scheduled_at', finMesbot)
              .neq('status', 'cancelled');

            if (countbot >= limitebot) {
              return { success: false, error: 'Lo siento, el negocio ha alcanzado su límite de citas este mes.' };
            }
          }

          const { data, error } = await supabaseAdmin
            .from('appointments')
            .insert({
              business_id: businessId,
              client_id: clienteExistente?.id || null,
              service_id: servicio.id,
              scheduled_at,
              status: 'confirmed',
              source: 'whatsapp',
              price: servicio.price,
              employee_id: empleadoDisponible.id
            })
            .select('id, scheduled_at')
            .single();

          if (error) {
            if (isBookingConflict(error)) {
              logger.warn('[DOUBLE_BOOKING_ATTEMPT]', { business_id: businessId, employee_id: empleadoDisponible.id, scheduled_at });
              return { success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora. Elige otro.' };
            }
            return { success: false, error: error.message };
          }

          if (data) {
            try {
              await supabaseAdmin
                .from('employees')
                .update({ last_appointment_at: new Date().toISOString() })
                .eq('id', empleadoDisponible.id);
            } catch (empErr) {
              logger.error('Error actualizando employee:', empErr.message);
            }

            // Notificar al dueño de la nueva cita
            try {
              const { data: negocioNotif } = await supabaseAdmin
                .from('businesses')
                .select('phone, name, whatsapp_phone_number_id')
                .eq('id', businessId)
                .single();

              if (negocioNotif?.phone) {
                const clienteNombre = data && clienteExistente?.name && clienteExistente.name !== 'Cliente WhatsApp'
                  ? clienteExistente.name
                  : 'Cliente nuevo';

                const horaFormateadaNotif = new Date(`${toolInput.fecha}T${toolInput.hora}:00-05:00`)
                  .toLocaleString('es-CO', {
                    timeZone: 'America/Bogota',
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                  });

                const empleadoNombreNotif = empleadoDisponible?.name && empleadoDisponible.name !== 'Sin asignar'
                  ? ` — ${empleadoDisponible.name}`
                  : '';

                const mensajeDueno = `📅 *Nueva cita por WhatsApp*\n\n` +
                  `👤 *Cliente:* ${clienteNombre}\n` +
                  `📱 *Teléfono:* ${clientPhone}\n` +
                  `✂️ *Servicio:* ${servicio.name}${empleadoNombreNotif}\n` +
                  `🕐 *Fecha y hora:* ${horaFormateadaNotif}\n` +
                  `💰 *Precio:* $${servicio.price.toLocaleString('es-CO')}`;

                const sender = ownerSender(business);
                const { result: sendResultNotif } = await notify({
                  to: negocioNotif.phone,
                  text: mensajeDueno,
                  template: { key: 'aviso_nueva_cita', body: [clienteNombre, clientPhone, `${servicio.name}${empleadoNombreNotif}`, horaFormateadaNotif, `${Number(servicio.price).toLocaleString('es-CO')}`] },
                  token: sender.token,
                  phoneNumberId: sender.phoneNumberId,
                  businessId,
                });

                if (!sendResultNotif.success && sendResultNotif.success !== undefined) {
                  logger.error('[NUEVA_CITA_NOTIF_FAILED]', {
                    to: maskPhone(negocioNotif.phone),
                    businessId,
                    error: sendResultNotif.error
                  });
                  await logSystemAlert('whatsapp_send_failed',
                    `Fallo notificación de nueva cita al dueño de ${negocioNotif.name}`,
                    businessId,
                    { to: maskPhone(negocioNotif.phone), error: sendResultNotif.error, messageType: 'nueva_cita_notif' });
                } else {
                  logger.info('Notificación enviada al dueño por nueva cita WhatsApp');
                }
              }
            } catch (notifErr) {
              logger.error('Error notificando al dueño: ' + notifErr.message);
              await logSystemAlert('whatsapp_send_failed',
                `Excepción en notificación de nueva cita al dueño`,
                businessId,
                { error: notifErr.message, messageType: 'nueva_cita_notif' });
            }
          }

          const horaFormateada = new Date(scheduled_at).toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          return {
            success: true,
            servicio: servicio.name,
            precio: servicio.price,
            empleado: empleadoDisponible?.name && empleadoDisponible.name !== 'Sin asignar' ? empleadoDisponible.name : null,
            scheduled_at,
            hora_colombia: horaFormateada
          };
        }

        case 'ver_mis_citas': {
          const { data: clienteDB } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('business_id', businessId)
            .eq('phone', clientPhone)
            .single();

          if (!clienteDB) return { citas: [], message: 'No tienes citas registradas' };

          const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
          const { data } = await supabaseAdmin
            .from('appointments')
            .select('id, scheduled_at, status, services(name, price), employees(name)')
            .eq('business_id', businessId)
            .eq('client_id', clienteDB.id)
            .neq('status', 'cancelled')
            .gte('scheduled_at', hoy + 'T00:00:00-05:00')
            .order('scheduled_at');

          const citasFormateadas = (data || []).map(c => {
            const horaCol = new Date(c.scheduled_at).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            });
            return {
              id: c.id,
              servicio: c.services?.name,
              precio: c.services?.price,
              empleado: c.employees?.name || null,
              fecha_hora_colombia: horaCol,
              status: c.status
            };
          });
          return { citas: citasFormateadas };
        }

        case 'cancelar_cita': {
          const cita = await citaDelCliente(toolInput.appointment_id);
          if (!cita) return CITA_NO_ENCONTRADA;
          return await deleteCitaIncome(cita.id, businessId);
        }

        case 'ver_productos': {
          const { data } = await supabaseAdmin
            .from('products')
            .select('name, price, stock')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .gt('stock', 0)
            .order('name');

          return { productos: data || [] };
        }

        case 'ver_mi_fidelizacion': {
          const { data: clienteData } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('business_id', businessId)
            .eq('phone', clientPhone)
            .maybeSingle();

          if (!clienteData) {
            return { visitas_acumuladas: 0, visitas_faltantes: null, message: 'Aún no tienes visitas registradas con nosotros' };
          }

          const clienteId = clienteData.id;

          const { data: loyalty } = await supabaseAdmin
            .from('client_loyalty')
            .select('loyalty_visits, total_visits')
            .eq('business_id', businessId)
            .eq('client_id', clienteId)
            .maybeSingle();

          const { data: config } = await supabaseAdmin
            .from('loyalty_config')
            .select('visits_for_reward, reward_service_id, services(name)')
            .eq('business_id', businessId)
            .maybeSingle();

          const visitas = loyalty?.loyalty_visits || 0;
          const meta = config?.visits_for_reward || 10;
          const faltan = Math.max(0, meta - visitas);
          const servicio_gratis = config?.services?.name || 'servicio gratis';

          return {
            visitas_acumuladas: visitas,
            visitas_para_recompensa: meta,
            visitas_faltantes: faltan,
            recompensa: servicio_gratis,
            listo_para_canjear: faltan === 0
          };
        }

        case 'ver_empleados': {
          const { data: empleados } = await supabaseAdmin
            .from('employees')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('is_active', true);

          return { empleados: empleados || [] };
        }

        case 'ver_horarios': {
          const { data: horarios } = await supabaseAdmin
            .from('business_hours')
            .select('day_of_week, open_time, close_time, is_open')
            .eq('business_id', businessId)
            .order('day_of_week');

          const diasNombres = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

          const horariosFormateados = (horarios || []).map(h => ({
            dia: diasNombres[h.day_of_week],
            abierto: h.is_open,
            apertura: h.open_time,
            cierre: h.close_time
          }));

          const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
          const en30 = new Date(Date.now() + 30*86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
          const { data: diasCerrados } = await supabaseAdmin
            .from('business_closed_days')
            .select('date, reason')
            .eq('business_id', businessId)
            .gte('date', hoy)
            .lte('date', en30)
            .order('date');

          if (toolInput.dia) {
            const diaLower = toolInput.dia.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            const horarioDia = horariosFormateados.find(h =>
              h.dia.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(diaLower)
            );
            return { horario_dia: horarioDia || null, dias_cerrados: diasCerrados || [] };
          }

          return { horarios: horariosFormateados, dias_cerrados: diasCerrados || [] };
        }

        case 'confirmar_asistencia': {
          const cita = await citaDelCliente(toolInput.appointment_id);
          if (!cita) return CITA_NO_ENCONTRADA;
          const { data, error } = await supabaseAdmin
            .from('appointments')
            .update({ status: 'confirmed' })
            .eq('id', cita.id)
            .eq('business_id', businessId)
            .in('status', ['pending', 'confirmed'])
            .select('id');

          if (error) return { success: false, error: error.message };
          if (!data || data.length === 0) {
            return { success: false, error: 'Cita no encontrada' };
          }
          return { success: true, message: 'Asistencia confirmada correctamente' };
        }

        case 'lista_espera': {
          try {
            const { data: clienteWait } = await supabaseAdmin
              .from('clients')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('phone', clientPhone)
              .limit(1);

            const { error } = await supabaseAdmin
              .from('waitlist')
              .insert({
                business_id: businessId,
                client_id: clienteWait?.[0]?.id || null,
                client_phone: clientPhone,
                client_name: clienteWait?.[0]?.name || 'Cliente WhatsApp',
                desired_date: toolInput.fecha,
                desired_time: toolInput.hora || null,
                desired_service: toolInput.servicio || null,
                status: 'waiting',
                created_at: new Date().toISOString()
              });

            if (error) {
              logger.error('Error lista espera: ' + error.message);
              return { success: false, error: 'No se pudo agregar a la lista de espera' };
            }

            return {
              success: true,
              message: `Quedaste en lista de espera para el ${toolInput.fecha}${toolInput.hora ? ' a las ' + toolInput.hora : ''}. Te avisamos si se libera un espacio 😊`
            };
          } catch(e) {
            logger.error('Error lista_espera: ' + e.message);
            return { success: false, error: 'No se pudo agregar a la lista de espera' };
          }
        }

        case 'actualizar_cita': {
          const citaPropia = await citaDelCliente(toolInput.appointment_id);
          if (!citaPropia) return CITA_NO_ENCONTRADA;
          if (!['pending', 'confirmed'].includes(citaPropia.status)) {
            return { success: false, error: 'Esa cita ya no está activa (fue cancelada o completada).' };
          }

          // Fecha y hora ACTUALES en hora de Colombia (el timestamptz llega en UTC: nunca split('T'))
          const actual = localParts(citaPropia.scheduled_at);

          let empleadoNuevo = null;
          if (toolInput.employee_name) {
            const { data: empMatches } = await supabaseAdmin
              .from('employees')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .ilike('name', `%${escapeLike(toolInput.employee_name)}%`);
            if (empMatches && empMatches.length > 1) {
              return { success: false, error: 'empleado_ambiguo', opciones: empMatches.map(e => ({ name: e.name })) };
            }
            if (!empMatches?.length) return { success: false, error: 'No encontré ningún empleado con ese nombre.' };
            empleadoNuevo = empMatches[0];
          }

          let servicioNuevo = null;
          if (toolInput.nuevo_servicio) {
            const found = await findService(businessId, toolInput.nuevo_servicio);
            if (found.ambiguo) return { success: false, error: 'servicio_ambiguo', opciones: found.opciones };
            if (!found.servicio) return { success: false, error: 'No encontré ese servicio. ¿Cuál quieres exactamente?' };
            servicioNuevo = found.servicio;
          }

          // Lo que no cambia se conserva en hora local
          let fecha = actual.fecha;
          let hora = actual.hora;
          if (toolInput.nueva_fecha) {
            if (!isValidDate(String(toolInput.nueva_fecha).trim())) return { success: false, error: 'Fecha inválida. Usa YYYY-MM-DD.' };
            fecha = String(toolInput.nueva_fecha).trim();
          }
          if (toolInput.nueva_hora) {
            hora = normalizeTime(toolInput.nueva_hora);
            if (!hora) return { success: false, error: 'Hora inválida. Usa HH:mm (24 horas).' };
          }
          const cambiaHorario = fecha !== actual.fecha || hora !== actual.hora;
          const cambiaEmpleado = empleadoNuevo && empleadoNuevo.id !== citaPropia.employee_id;
          if (!cambiaHorario && !cambiaEmpleado && !servicioNuevo) {
            return { success: false, error: 'No hay cambios que aplicar.' };
          }

          // Validación completa del resultado final: horario y festivo con la duración del servicio (nuevo o actual),
          // hora no pasada y que el empleado esté libre (sin contar esta misma cita)
          const durMin = (servicioNuevo || citaPropia.services)?.duration_minutes || DEFAULT_DURATION;
          const day = await loadDay(businessId, fecha);
          const fit = checkHours(day, hora, durMin);
          if (!fit.valid) return { success: false, error: fit.reason };
          if (cambiaHorario && toInstantMs(fecha, hora) <= Date.now()) {
            return { success: false, error: 'Esa hora ya pasó. Elige una hora futura.' };
          }

          let empId = empleadoNuevo?.id || citaPropia.employee_id;
          if (empId && !isEmployeeFree(day, empId, hora, durMin, { excludeAppointmentId: citaPropia.id })) {
            if (empleadoNuevo) {
              return { success: false, error: `${empleadoNuevo.name} no está disponible en ese horario. ¿Quieres con otro empleado?` };
            }
            // No se cambia de empleado sin preguntar: se ofrecen horas libres y, si lo hay, otro empleado libre
            const otro = await getAvailableEmployee(businessId, fecha, hora, durMin, { day, excludeAppointmentId: citaPropia.id });
            const alternativas = freeSlots({ ...day, empleados: day.empleados.filter(e => e.id === empId) }, durMin, { after: hora, limit: 3, excludeAppointmentId: citaPropia.id });
            return {
              success: false,
              error: 'Ese horario está ocupado para el empleado asignado.',
              slots_alternativos_mismo_empleado: alternativas,
              otro_empleado_disponible: otro?.name || null
            };
          }
          if (!empId) {
            const libre = await getAvailableEmployee(businessId, fecha, hora, durMin, { day, excludeAppointmentId: citaPropia.id });
            if (!libre) return { success: false, error: 'No hay empleados disponibles en ese horario.', slots_alternativos: freeSlots(day, durMin, { after: hora, limit: 3 }) };
            empId = libre.id;
          }

          const updateData = {};
          if (empId !== citaPropia.employee_id) updateData.employee_id = empId;
          if (servicioNuevo) { updateData.service_id = servicioNuevo.id; updateData.price = servicioNuevo.price; }
          if (cambiaHorario) updateData.scheduled_at = localISO(fecha, hora);

          const { data, error } = await supabaseAdmin
            .from('appointments')
            .update(updateData)
            .eq('id', citaPropia.id)
            .eq('business_id', businessId)
            .in('status', ['pending', 'confirmed'])
            .select('id');

          if (isBookingConflict(error)) return { success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora. Elige otro.' };
          if (error) return { success: false, error: error.message };
          if (!data || data.length === 0) return CITA_NO_ENCONTRADA;

          if (servicioNuevo) {
            const { error: incomeUpdError } = await supabaseAdmin
              .from('income')
              .update({ amount: servicioNuevo.price, description: `${servicioNuevo.name} - agendado por WhatsApp (actualizado)` })
              .eq('appointment_id', citaPropia.id)
              .eq('business_id', businessId)
              .select('id');
            if (incomeUpdError) {
              logger.error('[REAGENDAR_INCOME_UPDATE_FAILED]', { businessId, appointmentId: citaPropia.id, error: incomeUpdError.message });
            }
          }

          const empleadoFinal = day.empleados.find(e => e.id === empId)?.name || empleadoNuevo?.name || null;
          const horaColombia = new Date(localISO(fecha, hora)).toLocaleString('es-CO', {
            timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true
          });
          return {
            success: true,
            message: `Cita actualizada correctamente${cambiaEmpleado && empleadoFinal ? ` — ahora con ${empleadoFinal}` : ''}.`,
            servicio: (servicioNuevo || citaPropia.services)?.name || null,
            empleado: empleadoFinal,
            hora_colombia: horaColombia,
            nuevo_precio: servicioNuevo ? servicioNuevo.price : null
          };
        }

        case 'escalar_a_humano': {
          try {
            const { data: negocio } = await supabaseAdmin
              .from('businesses')
              .select('phone, name')
              .eq('id', businessId)
              .single();

            if (!negocio?.phone) {
              return { success: false, message: 'No se pudo notificar al dueño — número no configurado.' };
            }

            const clientNombre = clientInfo?.name && clientInfo.name !== 'Cliente WhatsApp'
              ? clientInfo.name
              : 'Un cliente';

            // El motivo lo redacta el modelo a partir del texto del cliente: se recorta (riesgo de phishing al dueño)
            const motivo = String(toolInput.motivo || 'Quiere hablar con una persona').replace(/[\r\n]+/g, ' ').slice(0, 200);
            const mensajeDueño = `⚠️ *Atención requerida en ${negocio.name}*\n\n` +
              `Tu cliente *${clientNombre}* (${clientPhone}) quiere hablar contigo.\n\n` +
              `*Motivo:* ${motivo}\n\n` +
              `Contáctalo directamente por WhatsApp.`;

            // Fuera de la ventana de 24 h con el dueño → plantilla aviso_escalamiento (si están activas)
            const sender = ownerSender(business);
            const { result: sendResult } = await notify({
              to: negocio.phone,
              text: mensajeDueño,
              template: { key: 'aviso_escalamiento', body: [negocio.name, clientNombre, clientPhone, motivo] },
              token: sender.token,
              phoneNumberId: sender.phoneNumberId,
              businessId,
            });

            if (!sendResult.success && sendResult.success !== undefined) {
              logger.error('[ESCALAMIENTO_SEND_FAILED]', {
                to: maskPhone(negocio.phone),
                businessId,
                error: sendResult.error
              });
              await logSystemAlert('whatsapp_send_failed',
                `CRÍTICO: Fallo notificación de escalamiento a dueño de ${negocio.name}`,
                businessId,
                { to: maskPhone(negocio.phone), error: sendResult.error, messageType: 'escalamiento_humano' });
              return {
                success: false,
                message: 'No se pudo notificar al dueño del escalamiento. Intenta de nuevo o contacta directamente.'
              };
            }

            const pausadoHasta = new Date();
            pausadoHasta.setHours(pausadoHasta.getHours() + 3);

            const { data: pauseData, error: updateError } = await supabaseAdmin
              .from('whatsapp_conversations')
              .update({ bot_paused_until: pausadoHasta.toISOString() })
              .eq('business_id', businessId)
              .eq('client_phone', clientPhone)
              .select('id');

            if (updateError || !pauseData || pauseData.length === 0) {
              logger.error('[ESCALAR_PAUSE_FAILED]', {
                businessId,
                phone: maskPhone(clientPhone),
                error: updateError?.message
              });
              return {
                success: false,
                message: 'Le avisé al dueño pero no pude pausar el bot correctamente. Por favor intenta de nuevo o escribe directamente.'
              };
            }

            logger.info('Bot pausado por 3 horas para cliente:', { phone: maskPhone(clientPhone), hasta: pausadoHasta.toISOString() });

            return {
              success: true,
              message: 'Dueño notificado correctamente.'
            };
          } catch(e) {
            logger.error('Error escalando a humano:', e.message);
            return { success: false, message: 'No se pudo notificar al dueño.' };
          }
        }

        case 'gestionar_grupo': {
          const { accion, persona } = toolInput;

          // Leer contexto actual
          const { data: convActual } = await supabaseAdmin
            .from('whatsapp_conversations')
            .select('context')
            .eq('business_id', businessId)
            .eq('client_phone', clientPhone)
            .maybeSingle();

          const contexto = convActual?.context || {};
          const grupo = contexto.grupo || { personas: [], confirmadas: 0 };

          if (accion === 'leer_progreso') {
            return {
              grupo_activo: grupo.personas.length > 0,
              personas: grupo.personas,
              total: grupo.personas.length,
              confirmadas: grupo.confirmadas
            };
          }

          if (accion === 'limpiar') {
            await supabaseAdmin
              .from('whatsapp_conversations')
              .update({ context: { ...contexto, grupo: null } })
              .eq('business_id', businessId)
              .eq('client_phone', clientPhone);
            return { success: true, message: 'Grupo limpiado.' };
          }

          if (accion === 'agregar_persona' && persona) {
            grupo.personas.push({
              nombre: persona.nombre || 'Sin nombre',
              servicio: persona.servicio,
              fecha: persona.fecha,
              hora: persona.hora,
              agendada: false
            });

            const { data: grupoData, error: grupoError } = await supabaseAdmin
              .from('whatsapp_conversations')
              .upsert({
                business_id: businessId,
                client_phone: clientPhone,
                context: { ...contexto, grupo }
              }, { onConflict: 'business_id,client_phone' })
              .select('id');

            if (grupoError || !grupoData || grupoData.length === 0) {
              logger.warn('[GESTIONAR_GRUPO_UPSERT_FAILED]', { businessId, phone: maskPhone(clientPhone), error: grupoError?.message });
            }

            return {
              success: true,
              total_en_grupo: grupo.personas.length,
              personas: grupo.personas
            };
          }

          if (accion === 'confirmar_todas') {
            const resultados = [];
            const pendientes = grupo.personas.filter(p => !p.agendada);

            // Validar límite de citas del mes para el grupo
            const { data: bizGrp } = await supabaseAdmin
              .from('businesses')
              .select('plan')
              .eq('id', businessId)
              .single();

            const limitegrp = getPlan(bizGrp?.plan).max_appointments_month;
            let contadorCitasGrp = 0;

            if (limitegrp !== -1) {
              const _tzgrp = require('../utils/timezone').getTimezone();
              const _offgrp = require('../utils/timezone').getOffsetForTz(_tzgrp);
              const mesActualgrp = new Date().toLocaleDateString('en-CA', { timeZone: _tzgrp }).slice(0, 7);
              const inicioMesgrp = `${mesActualgrp}-01T00:00:00${_offgrp}`;
              const [yrgrp, mogrp] = mesActualgrp.split('-').map(Number);
              const ultimoDiagrp = new Date(yrgrp, mogrp, 0).getDate();
              const finMesgrp = `${mesActualgrp}-${String(ultimoDiagrp).padStart(2, '0')}T23:59:59${_offgrp}`;

              const { count: countgrp } = await supabaseAdmin
                .from('appointments')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', businessId)
                .gte('scheduled_at', inicioMesgrp)
                .lte('scheduled_at', finMesgrp)
                .neq('status', 'cancelled');

              contadorCitasGrp = countgrp || 0;
            }

            for (const p of pendientes) {
              const pHora = normalizeTime(p.hora);
              if (!p.servicio || !isValidDate(p.fecha) || !pHora) {
                resultados.push({ nombre: p.nombre, success: false, error: 'Faltan datos o la fecha/hora no es válida' });
                continue;
              }
              p.hora = pHora;

              const foundGrp = await findService(businessId, p.servicio);
              const servicio = foundGrp.servicio;
              if (!servicio) {
                resultados.push({ nombre: p.nombre, success: false, error: foundGrp.ambiguo ? `Servicio ambiguo: ${foundGrp.opciones.map(o => o.name).join(', ')}` : 'Servicio no encontrado' });
                continue;
              }
              const durGrp = servicio.duration_minutes || DEFAULT_DURATION;

              // Mismas validaciones que agendar_cita: horario/festivo con la duración, hora no pasada y solape real
              const dayGrp = await loadDay(businessId, p.fecha);
              const horarioValidoGrp = checkHours(dayGrp, p.hora, durGrp);
              if (!horarioValidoGrp.valid) {
                resultados.push({ nombre: p.nombre, success: false, error: horarioValidoGrp.reason });
                continue;
              }
              if (toInstantMs(p.fecha, p.hora) <= Date.now()) {
                resultados.push({ nombre: p.nombre, success: false, error: 'Esa hora ya pasó' });
                continue;
              }

              // Buscar empleado disponible (loadDay ya incluye las citas del grupo creadas en esta misma vuelta)
              const empleado = await getAvailableEmployee(businessId, p.fecha, p.hora, durGrp, { day: dayGrp });
              if (!empleado) {
                resultados.push({ nombre: p.nombre, success: false, error: `Sin empleados disponibles a las ${p.hora}` });
                continue;
              }
              // Obtener cliente principal (el que escribe)
              const { data: clientePrincipal } = await supabaseAdmin
                .from('clients')
                .select('id, name')
                .eq('business_id', businessId)
                .eq('phone', clientPhone)
                .maybeSingle();

              const scheduled_at = `${p.fecha}T${p.hora}:00-05:00`;
              const notaNombre = p.nombre && p.nombre !== 'Sin nombre'
                ? `Para: ${p.nombre}`
                : null;

              // Validar límite antes de cada cita
              if (limitegrp !== -1 && contadorCitasGrp >= limitegrp) {
                resultados.push({ nombre: p.nombre, success: false, error: 'Límite de citas del mes alcanzado' });
                continue;
              }

              const { data: cita, error } = await supabaseAdmin
                .from('appointments')
                .insert({
                  business_id: businessId,
                  client_id: clientePrincipal?.id || null,
                  service_id: servicio.id,
                  scheduled_at,
                  status: 'confirmed',
                  source: 'whatsapp',
                  price: servicio.price,
                  employee_id: empleado.id,
                  notes: notaNombre
                })
                .select('id')
                .single();

              if (error) {
                if (isBookingConflict(error)) {
                  // Constraint de no-double-booking: horario ya fue tomado
                  resultados.push({ nombre: p.nombre, success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora.' });
                } else {
                  resultados.push({ nombre: p.nombre, success: false, error: error.message });
                }
                continue;
              }

              // Income se genera automáticamente cuando scheduler.service.js auto-completa la cita (1+ hora después)
              // Esto alinea citas grupales con el patrón de citas individuales

              const horaFormateada = new Date(scheduled_at).toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              });

              p.agendada = true;
              contadorCitasGrp++;
              resultados.push({
                nombre: p.nombre,
                success: true,
                servicio: servicio.name,
            empleado: empleado.name && empleado.name !== 'Sin asignar' ? empleado.name : null,
                hora_colombia: horaFormateada,
                precio: servicio.price
              });
            }

            // Limpiar grupo del context
            await supabaseAdmin
              .from('whatsapp_conversations')
              .update({ context: { ...contexto, grupo: null } })
              .eq('business_id', businessId)
              .eq('client_phone', clientPhone);

            const exitosas = resultados.filter(r => r.success).length;
            const fallidas = resultados.filter(r => !r.success).length;

            return {
              success: exitosas > 0,
              total: resultados.length,
              exitosas,
              fallidas,
              resultados
            };
          }

          return { error: 'Acción no reconocida' };
        }

        default:
          return { error: 'Función no disponible' };
      }
    } catch (error) {
      logger.error('TOOL_ERROR_' + toolName + '_' + (error.message || String(error)).replace(/\s+/g, '_').slice(0, 300));
      return { error: error.message };
    }
  }

  // Historial: solo texto, empezando por un mensaje del cliente. Se recorta "por bloques" (12 → últimos 6) y no de a
  // un mensaje: así el inicio de la conversación no cambia en cada turno y el prefijo de mensajes se lee de caché.
  let cleanHistory = (history || []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  if (cleanHistory.length > HISTORY_MAX) cleanHistory = cleanHistory.slice(-HISTORY_KEEP);
  while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') cleanHistory.shift();

  // Límite de longitud contra amplificación de costo (max 2000 chars)
  const maxMessageLength = 2000;
  let processedMessage = String(messageText || '');
  if (processedMessage.length > maxMessageLength) {
    logger.warn(`Mensaje truncado de ${processedMessage.length} a ${maxMessageLength} chars`);
    processedMessage = processedMessage.substring(0, maxMessageLength) + '...';
  }
  // Sin las etiquetas del delimitador dentro del texto: el cliente no puede "cerrar" el bloque e inyectar instrucciones
  processedMessage = processedMessage.replace(/<\/?mensaje_usuario>/gi, '');

  // Cada mensaje del cliente se envuelve igual en el historial y en el turno actual (mismos bytes → caché)
  const wrapUser = (t) => `<mensaje_usuario>\n${String(t).replace(/<\/?mensaje_usuario>/gi, '')}\n</mensaje_usuario>`;
  const messages = [
    ...cleanHistory.map((m) => (m.role === 'user'
      ? { role: 'user', content: [{ type: 'text', text: wrapUser(m.content) }] }
      : { role: 'assistant', content: m.content })),
    // Texto del cliente (breakpoint 3) + contexto volátil al final (hora, cliente, citas activas)
    { role: 'user', content: [{ type: 'text', text: wrapUser(processedMessage) }, { type: 'text', text: botRequest.volatileText }] },
  ];
  const userIdx = messages.length - 1;

  // Breakpoints de caché en los mensajes (máx. 4 en total; 2 ya van en el system):
  //  - el texto del cliente de este turno → el siguiente turno lee de caché todo lo anterior
  //  - el último tool_result del loop → cada vuelta del loop lee la anterior
  function withCacheBreakpoints(msgs) {
    const out = msgs.slice();
    const mark = (i, blockIdx) => {
      const content = out[i].content.map((b, j) => (j === blockIdx ? { ...b, cache_control: { type: 'ephemeral' } } : b));
      out[i] = { ...out[i], content };
    };
    mark(userIdx, 0);
    const last = out.length - 1;
    if (last > userIdx && out[last].role === 'user' && Array.isArray(out[last].content)) mark(last, out[last].content.length - 1);
    return out;
  }

  const requestId = newRequestId();
  const conversationKey = convKey(businessId, clientPhone);
  const callClaude = (msgs, iteration) => callClaudeWithRetry(anthropicClient, {
    model: BOT_MODEL,
    max_tokens: BOT_MAX_TOKENS,
    system: botRequest.system,
    tools: botRequest.tools,
    messages: withCacheBreakpoints(msgs),
  }, 2, { flow: 'whatsapp_bot', businessId, conversationKey, requestId, iteration });

  let response;
  try {
    response = await callClaude(messages, 0);
  } catch (claudeError) {
    logger.error('Error de Claude:', claudeError.message);
    throw claudeError;
  }

  try {
    const allMessages = [...messages];
    let iterations = 0;

    while (response.stop_reason === 'tool_use' && iterations < BOT_MAX_TOOL_ITERATIONS) {
      iterations++;
      const assistantContent = response.content;
      allMessages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      let shouldBreak = false;
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await executeChatbotTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
          // Si se ejecutó escalar_a_humano exitosamente, detener el loop
          if (block.name === 'escalar_a_humano' && result.success) {
            shouldBreak = true;
          }
        }
      }

      // Si se escaló a humano, retornar el mensaje de confirmación sin seguir procesando
      if (shouldBreak) {
        return { response: 'Listo, le avisé al dueño. Te contactarán pronto 😊', userText: processedMessage };
      }

      allMessages.push({ role: 'user', content: toolResults });
      response = await callClaude(allMessages, iterations);
    }

    if (response.stop_reason === 'tool_use') {
      logger.warn('[BOT_MAX_ITERACIONES]', { businessId, iterations });
    }

    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Limpiar tags internos espurios (ej: </final_message>, </fin>, etc) que el modelo puede generar ocasionalmente
    const cleanText = finalText.replace(/<\/?[a-z_]+>/gi, '').trim();

    return { response: cleanText, userText: processedMessage };
  } catch (error) {
    logger.error('Error procesando respuesta:', error.message);
    throw error;
  }
}

// La deduplicación por message_id se hace al recibir el webhook (conversationStore.claimMessageId),
// antes de encolar: aquí cada mensaje llega una sola vez.
async function processWhatsAppMessage({ from, phoneNumberId, messageText, messageId }) {
  const receivedAt = new Date().toISOString();
  logger.info('Mensaje WhatsApp recibido', { to: maskPhone(from), messageId });
  let business = null;
  let businessToken = null;

  try {
    business = await getBusinessByPhoneNumberId(phoneNumberId);

    if (!business) {
      logger.warn('Negocio no encontrado para el phone_number_id');
      return;
    }

    businessToken = business.whatsapp_access_token
      ? decrypt(business.whatsapp_access_token)
      : null;

    if (isPlanExpired(business)) {
      logger.warn('Negocio con plan/trial expirado, bot bloqueado', { businessId: business.id });
      await sendMessage(from, 'Este negocio no está disponible en este momento, intenta más tarde 🙏', businessToken, business.whatsapp_phone_number_id);
      await notifyOwnerPlanExpired(business);
      return;
    }

    // Una sola lectura de la fila de conversación: pausa + historial
    const conversation = await loadConversation(business.id, from);
    const history = conversation?.messages || [];

    if (conversation?.bot_paused_until && new Date(conversation.bot_paused_until) > new Date()) {
      // Pausado (escalado a humano): no responde, pero el mensaje queda en el historial para el dueño
      // y para que el bot tenga el contexto cuando se reactive. No se reprocesa después.
      await saveConversationHistory(business.id, from, [...history, { role: 'user', content: messageText, timestamp: receivedAt }]);
      logger.info('Bot pausado para el cliente; mensaje guardado sin responder', { businessId: business.id, to: maskPhone(from) });
      return;
    }

    const client_info = await getOrCreateClient(business.id, from);

    logger.info('Cliente e historial cargados', { clientId: client_info?.id, historyLength: history.length });
    // Verificar límites diarios: 50 msgs/cliente/día, 300 msgs/negocio/día
    const hoyColombia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    const { data: clientDayStats } = await supabaseAdmin
      .from('bot_daily_message_counts')
      .select('message_count')
      .eq('business_id', business.id)
      .eq('client_phone', from)
      .eq('date', hoyColombia)
      .maybeSingle();

    // Normalizado para los atajos: sin signos ('¡Sí!' → 'sí', 'no.' → 'no')
    const msgLower = messageText.toLowerCase().replace(/[¡!¿?.,;]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Fast-path: saludos/despedidas sin llamar a Claude (si historial vacío o >2h desde último mensaje)
    const esSaludo = ['hola', 'buenas', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'hey', 'que tal', 'qué tal'].includes(msgLower);
    const esDespedida = ['chao', 'adios', 'adiós', 'hasta luego', 'nos vemos', 'bye'].includes(msgLower);

    if (esSaludo || esDespedida) {
      // Validar condición: historial vacío O último mensaje de usuario fue hace >2h
      let debeActivarFastPath = history.length === 0;

      if (!debeActivarFastPath && history.length > 0) {
        const ultimoUserMsg = [...history].reverse().find(m => m.role === 'user');
        if (ultimoUserMsg?.timestamp) {
          const ahora = new Date().getTime();
          const ultimoMsgTiempo = new Date(ultimoUserMsg.timestamp).getTime();
          const dorasEnMs = 2 * 60 * 60 * 1000;
          debeActivarFastPath = (ahora - ultimoMsgTiempo) > dorasEnMs;
        }
      }

      if (debeActivarFastPath) {
        if (esSaludo) {
          const respuesta = client_info?.name && client_info.name !== 'Cliente WhatsApp'
            ? `Hola ${client_info.name} 👋 ¿En qué te ayudo hoy?`
            : `¡Hola! Bienvenido a ${business.name} 👋 ¿En qué te puedo ayudar? Puedo agendarte una cita o contarte sobre nuestros servicios 😊`;

          await sendMessage(from, respuesta, businessToken, business.whatsapp_phone_number_id);
          await saveConversationHistory(business.id, from, [
            ...history,
            { role: 'user', content: messageText, timestamp: receivedAt },
            { role: 'assistant', content: respuesta }
          ]);
          await incrementDailyMessageCount(business.id, from);
          return;
        } else if (esDespedida) {
          const respuesta = `¡Hasta luego! 👋 Que tengas un excelente día 😊`;
          await sendMessage(from, respuesta, businessToken, business.whatsapp_phone_number_id);
          await saveConversationHistory(business.id, from, [
            ...history,
            { role: 'user', content: messageText, timestamp: receivedAt },
            { role: 'assistant', content: respuesta }
          ]);
          await incrementDailyMessageCount(business.id, from);
          return;
        }
      }
    }

    // DESPUÉS del fast-path de saludos/despedidas: verificar límites diarios (saludos no cuentan)
    const clientMsgCountToday = clientDayStats?.message_count || 0;

    if (clientMsgCountToday >= 50) {
      const respuestaLimite = 'Has alcanzado el límite de mensajes por hoy. Puedes escribir de nuevo mañana 😊';
      await sendMessage(from, respuestaLimite, businessToken, business.whatsapp_phone_number_id);
      return;
    }

    const { data: businessDayStats, count: businessMsgCountToday } = await supabaseAdmin
      .from('bot_daily_message_counts')
      .select('message_count', { count: 'exact' })
      .eq('business_id', business.id)
      .eq('date', hoyColombia);

    const totalBusinessMsgToday = businessDayStats?.reduce((sum, s) => sum + (s.message_count || 0), 0) || 0;

    // El límite sale del plan real del negocio (antes el SELECT no traía 'plan' y todos quedaban en Lite = 40)
    const planConfig = getPlan(business.plan);
    const botMessagesLimit = planConfig.bot_messages_day;

    // Dedupe de alerta: solo una por negocio por día
    const { data: existingAlert } = await supabaseAdmin
      .from('system_alerts')
      .select('id')
      .eq('tipo', 'bot_daily_limit_reached')
      .eq('business_id', business.id)
      .gte('created_at', hoyColombia + 'T00:00:00-05:00')
      .limit(1)
      .maybeSingle();

    if (totalBusinessMsgToday >= botMessagesLimit) {
      const respuestaLimiteBusiness = 'El negocio ha alcanzado su límite de mensajes por hoy. Por favor, contacta directamente al negocio mañana 😊';
      await sendMessage(from, respuestaLimiteBusiness, businessToken, business.whatsapp_phone_number_id);

      // Solo registra alerta si no existe una ya hoy
      if (!existingAlert) {
        await logSystemAlert('bot_daily_limit_reached',
          `Bot alcanzó límite diario (${botMessagesLimit} msgs) para negocio ${business.name}`,
          business.id,
          { totalMessages: totalBusinessMsgToday, limit: botMessagesLimit });
      }
      return;
    }

    // Atajo de confirmación/cancelación: SOLO si lo último en la conversación fue el recordatorio de una cita
    // (guardado por el scheduler con kind:'reminder' y su appointment_id). Un "sí"/"no" a cualquier otra pregunta
    // del bot va a Claude, que tiene el contexto. Y se actúa sobre ESA cita, no sobre "la más próxima".
    const recordatorio = pendingReminder(history);
    const esConfirmacion = CONFIRM_WORDS.has(msgLower);
    const esCancelacion = CANCEL_WORDS.has(msgLower);

    if (recordatorio && (esConfirmacion || esCancelacion)) {
      const { data: clienteCheck } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone', from)
        .limit(1);
      const clienteId = clienteCheck?.[0]?.id;

      const { data: citaRecordada } = clienteId ? await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, services(name)')
        .eq('id', recordatorio.appointmentId)
        .eq('business_id', business.id)
        .eq('client_id', clienteId)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle() : { data: null };

      if (citaRecordada && new Date(citaRecordada.scheduled_at).getTime() > Date.now()) {
        const horaFormateada = new Date(citaRecordada.scheduled_at).toLocaleString('es-CO', {
          timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true
        });
        let respuesta;
        if (esConfirmacion) {
          const { data: confirmedRows, error: confirmError } = await supabaseAdmin
            .from('appointments')
            .update({ status: 'confirmed' })
            .eq('id', citaRecordada.id)
            .eq('business_id', business.id)
            .in('status', ['pending', 'confirmed'])
            .select('id');
          if (confirmError || !confirmedRows?.length) {
            logger.error('[FASTPATH_CONFIRMAR_CITA_FAILED]', { appointmentId: citaRecordada.id, businessId: business.id, error: confirmError?.message });
            respuesta = 'Uy, no pude confirmar tu cita en este momento. Por favor intenta de nuevo en unos minutos o escríbenos.';
          } else {
            respuesta = `✅ ¡Perfecto! Tu cita de ${citaRecordada.services?.name || 'tu servicio'} el ${horaFormateada} está confirmada. ¡Te esperamos! 😊`;
          }
        } else {
          const cancelResult = await deleteCitaIncome(citaRecordada.id, business.id);
          if (!cancelResult.success) {
            logger.error('[FASTPATH_CANCELAR_CITA_FAILED]', { appointmentId: citaRecordada.id, businessId: business.id, error: cancelResult.error });
            respuesta = 'Uy, no pude cancelar tu cita en este momento. Por favor intenta de nuevo en unos minutos o escríbenos.';
          } else {
            respuesta = `Entendido, cancelé tu cita de ${citaRecordada.services?.name || 'tu servicio'} del ${horaFormateada} 😊 Cuando quieras reagendar aquí estoy.`;
          }
        }
        await sendMessage(from, respuesta, businessToken, business.whatsapp_phone_number_id);
        await saveConversationHistory(business.id, from, [
          ...history,
          { role: 'user', content: messageText, timestamp: receivedAt },
          { role: 'assistant', content: respuesta }
        ]);
        await incrementDailyMessageCount(business.id, from);
        return;
      }
      // La cita del recordatorio ya no está activa: sigue el flujo normal con Claude
    }

    let result;
    try {
      result = await processChatbotMessage(business.id, from, messageText, history, business, client_info);
      logger.info('Mensaje procesado exitosamente');
    } catch(e) {
      logger.error('Error procesando mensaje:', e.message);
      await sendMessage(from, 'Estoy teniendo problemas técnicos en este momento 🙏 Escríbeme en unos minutos e intento de nuevo.', businessToken, business.whatsapp_phone_number_id);
      return;
    }

    // WhatsApp rechaza mensajes vacíos: si el modelo no dejó texto (p. ej. agotó las iteraciones), respaldo
    if (!result.response || !String(result.response).trim()) {
      logger.error('[BOT_RESPUESTA_VACIA]', { businessId: business.id });
      await logSystemAlert('bot_empty_response', 'El bot terminó sin texto para responder', business.id, { messageType: 'bot_response' });
      result.response = 'Perdona, no te entendí bien 🙏 ¿Me lo puedes decir de otra forma?';
    }

    try {
      // Solo texto: el mensaje del cliente (con la hora en que llegó) y la respuesta final del bot
      await saveConversationHistory(business.id, from, [
        ...history,
        { role: 'user', content: result.userText || messageText, timestamp: receivedAt },
        { role: 'assistant', content: result.response }
      ]);
      await incrementDailyMessageCount(business.id, from);
    } catch(e) {
      logger.error('Error guardando historial:', e.message);
    }

    try {
      const sendResult = await sendMessage(from, result.response, businessToken, business.whatsapp_phone_number_id);
      if (sendResult && sendResult.success === false) {
        logger.error('[WHATSAPP_SEND_FAILED] Envío de respuesta fallido', { to: maskPhone(from), businessId: business.id, error: sendResult.error, status: sendResult.status });
        await logSystemAlert('whatsapp_send_failed', 'Fallo envío de respuesta del bot', business.id,
          { to: maskPhone(from), error: sendResult.error, messageType: 'bot_response' });
      } else {
        logger.info('Mensaje enviado al cliente');
      }
    } catch(e) {
      logger.error('Error enviando mensaje:', e.message);
      await logSystemAlert('whatsapp_send_failed', 'Excepción en envío de respuesta del bot', business.id,
        { to: maskPhone(from), error: e.message, messageType: 'bot_response' });
    }

  } catch (error) {
    logger.error('Error general en processWhatsAppMessage:', error.message);
    // El respaldo sale SIEMPRE desde el número del negocio (con su token). Si no se pudo resolver el negocio,
    // no se manda nada: antes salía desde el número global de ZITA.
    if (!business?.whatsapp_phone_number_id || !businessToken) return;
    try {
      const sendResult = await sendMessage(from, 'Tuve un problema técnico 😕 Intenta escribirme de nuevo en un momento.', businessToken, business.whatsapp_phone_number_id);
      if (sendResult && sendResult.success === false) {
        await logSystemAlert('whatsapp_send_failed', 'Fallo envío de mensaje de respaldo del bot', business.id,
          { to: maskPhone(from), error: sendResult.error, messageType: 'fallback' });
      }
    } catch (e) {
      await logSystemAlert('whatsapp_send_failed', 'Excepción en envío de mensaje de respaldo del bot', business.id,
        { to: maskPhone(from), error: e.message, messageType: 'fallback' });
    }
  }
}

module.exports = { processWhatsAppMessage, processChatbotMessage, buildBotRequest, getBusinessByPhoneNumberId, transcribeAudio, __setAnthropicClientForTests };
