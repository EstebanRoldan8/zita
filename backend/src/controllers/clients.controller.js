const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');
const { notify } = require('../services/whatsappNotify');
const { businessSender } = require('../services/businessSender');
const { maskPhone } = require('../utils/phone');

const capitalizeName = (str) => str.trim().replace(/\b\w/g, c => c.toUpperCase());

async function getAll(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { includeArchived } = req.query;

    // 1. Traer todos los clientes (excluir archivados por defecto)
    let clientsQuery = userClient
      .from('clients')
      .select('id, name, phone, email, notes, created_at')
      .eq('business_id', req.businessId);

    if (includeArchived !== 'true') {
      clientsQuery = clientsQuery.eq('archived', false);
    }

    const { data: clients, error: clientsError } = await clientsQuery
      .order('name');

    if (clientsError) throw clientsError;

    // 2. Traer client_loyalty (pueden no existir todos)
    const { data: loyaltyData, error: loyaltyError } = await userClient
      .from('client_loyalty')
      .select('client_id, total_visits, loyalty_visits')
      .eq('business_id', req.businessId);

    if (loyaltyError) {
      logger.error(`clients.getAll: loyalty query error - ${loyaltyError.message}`);
    }

    const loyaltyMap = {};
    (loyaltyData || []).forEach(l => {
      loyaltyMap[l.client_id] = { total_visits: l.total_visits, loyalty_visits: l.loyalty_visits };
    });

    // 3. Traer todas las appointments completadas
    const { data: appointments, error: appointmentsError } = await userClient
      .from('appointments')
      .select('client_id, price, status')
      .eq('business_id', req.businessId)
      .eq('status', 'completed');

    if (appointmentsError) throw appointmentsError;

    // Mapas para visits y spent desde appointments
    const appointmentsMap = {};
    (appointments || []).forEach(a => {
      if (!appointmentsMap[a.client_id]) {
        appointmentsMap[a.client_id] = { visits: 0, spent: 0 };
      }
      appointmentsMap[a.client_id].visits += 1;
      appointmentsMap[a.client_id].spent += (a.price || 0);
    });

    // 4. Para cada cliente: usar loyalty.total_visits si existe, sino contar appointments
    const withStats = clients.map(c => ({
      ...c,
      total_visits: loyaltyMap[c.id] !== undefined ? loyaltyMap[c.id].total_visits : (appointmentsMap[c.id]?.visits || 0),
      loyalty_visits: loyaltyMap[c.id]?.loyalty_visits || 0,
      total_spent: appointmentsMap[c.id]?.spent || 0,
    }));

    return res.json({ success: true, data: withStats });
  } catch (err) {
    logger.error(`clients.getAll: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getOne(req, res) {
  try {
    const { id } = req.params;
    logger.info(`clients.getOne: fetching client id=${id}, businessId=${req.businessId}`);
    const userClient = createUserClient(req.headers.authorization);

    const { data: client, error: clientError } = await userClient
      .from('clients')
      .select('id, name, phone, email, notes, created_at')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (clientError) {
      logger.error(`clients.getOne: query error - ${clientError.message}`);
      if (clientError.code === 'PGRST116') {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
      }
      throw clientError;
    }

    if (!client) {
      logger.warn(`clients.getOne: no client found for id=${id}, businessId=${req.businessId}`);
      return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
    }

    const { data: appointments, error: appointmentsError } = await userClient
      .from('appointments')
      .select('*, services(name, price), employees(name)')
      .eq('client_id', id)
      .eq('business_id', req.businessId)
      .order('scheduled_at', { ascending: false })
      .limit(10);

    if (appointmentsError) {
      logger.error(`clients.getOne: appointments query error - ${appointmentsError.message}`);
    }

    const { data: loyalty, error: loyaltyError } = await userClient
      .from('client_loyalty')
      .select('total_visits, loyalty_visits, last_redeemed_at')
      .eq('business_id', req.businessId)
      .eq('client_id', id)
      .single();

    if (loyaltyError && loyaltyError.code !== 'PGRST116') {
      logger.error(`clients.getOne: loyalty query error - ${loyaltyError.message}`);
    }

    let totalVisits = loyalty?.total_visits ?? 0;
    let loyaltyVisits = loyalty?.loyalty_visits ?? 0;
    let totalSpent = 0;
    (appointments || []).forEach(a => {
      if (a.status === 'completed') {
        totalSpent += (a.price || 0);
      }
    });

    return res.json({ success: true, data: { ...client, appointments: appointments || [], total_visits: totalVisits, loyalty_visits: loyaltyVisits, total_spent: totalSpent, last_redeemed_at: loyalty?.last_redeemed_at || null } });
  } catch (err) {
    logger.error(`clients.getOne: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function create(req, res) {
  try {
    const { name, phone, email } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'name y phone son obligatorios.' });
    }

    const userClient = createUserClient(req.headers.authorization);
    const capitalizedName = capitalizeName(name);
    let normalizedPhone = phone.trim();
    if (normalizedPhone.startsWith('+57')) {
      normalizedPhone = normalizedPhone.slice(3);
    } else if (normalizedPhone.startsWith('57') && normalizedPhone.length > 10) {
      normalizedPhone = normalizedPhone.slice(2);
    }
    const { data, error } = await userClient
      .from('clients')
      .insert({ business_id: req.businessId, name: capitalizedName, phone: normalizedPhone, email })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'Ya existe un cliente con ese teléfono.' });
      }
      throw error;
    }

    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`clients.create: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('clients')
      .select('id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    const { name, phone, email, notes } = req.body;

    const updates = {};
    if (name  !== undefined) updates.name  = name?.trim() ? capitalizeName(name) : null;
    if (phone !== undefined) {
      let normalizedPhone = phone?.trim();
      if (normalizedPhone) {
        if (normalizedPhone.startsWith('+57')) {
          normalizedPhone = normalizedPhone.slice(3);
        } else if (normalizedPhone.startsWith('57') && normalizedPhone.length > 10) {
          normalizedPhone = normalizedPhone.slice(2);
        }
      }
      updates.phone = normalizedPhone || null;
    }
    if (email !== undefined) updates.email = email?.trim() || null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;

    const { data, error } = await userClient
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'Ya existe un cliente con ese teléfono.' });
      }
      throw error;
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`clients.update: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function destroy(req, res) {
  try {
    const { id } = req.params;
    const userClient = createUserClient(req.headers.authorization);

    const { data: futureAppointments } = await userClient
      .from('appointments')
      .select('id')
      .eq('client_id', id)
      .neq('status', 'cancelled')
      .gt('scheduled_at', new Date().toISOString())
      .limit(1);

    if (futureAppointments && futureAppointments.length > 0) {
      return res.status(409).json({ success: false, error: 'No se puede eliminar el cliente porque tiene citas futuras programadas.' });
    }

    // Archivar en vez de borrar (soft-delete)
    const { data, error } = await userClient
      .from('clients')
      .update({ archived: true })
      .eq('id', id)
      .eq('business_id', req.businessId)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
    }
    return res.json({ success: true, message: 'Cliente archivado correctamente.' });
  } catch (err) {
    logger.error(`clients.destroy: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// Recordatorio manual a un cliente (Clientes → Recordar). Pasa por notify(): dentro de la ventana de 24 h sale
// el mensaje personalizado del negocio; fuera de ella, la plantilla aprobada te_extranamos (si están activas).
// Sale del número del negocio con su token. Sin PII en logs (ni teléfono completo ni el texto).
async function recallClient(req, res) {
  try {
    const { id } = req.params;
    const userClient = createUserClient(req.headers.authorization);
    const { supabaseAdmin } = require('../config/supabase');

    const { data: client, error: clientError } = await userClient
      .from('clients')
      .select('id, name, phone')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (clientError || !client) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
    }

    if (!client.phone) {
      return res.status(400).json({ success: false, error: 'El cliente no tiene teléfono registrado.' });
    }

    const { data: business, error: businessError } = await supabaseAdmin
      .from('businesses')
      .select('name, recall_message, whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', req.businessId)
      .single();

    if (businessError || !business) {
      return res.status(500).json({ success: false, error: 'Error al obtener datos del negocio.' });
    }

    const sender = businessSender(business, { businessId: req.businessId, context: 'recordatorio_manual' });
    if (!sender) {
      return res.status(400).json({ success: false, error: 'Conecta el WhatsApp del negocio para enviar recordatorios.' });
    }

    let phone = client.phone.replace(/D/g, '');
    if (phone.startsWith('0')) phone = '57' + phone.slice(1);
    if (!phone.startsWith('57') && phone.length === 10) {
      phone = '57' + phone;
    }

    const DEFAULT_MESSAGE = 'Hola {nombre} 👋 Hace un tiempo no te vemos en {negocio}. ¡Te esperamos para tu próxima visita! Escríbenos para agendar fácilmente 😊';
    const mensajeFinal = (business.recall_message || DEFAULT_MESSAGE)
      .replace('{nombre}', client.name)
      .replace('{negocio}', business.name);

    const { via, result } = await notify({
      to: phone,
      text: mensajeFinal,
      template: { key: 'te_extranamos', body: [client.name, business.name] },
      token: sender.token,
      phoneNumberId: sender.phoneNumberId,
      businessId: req.businessId,
      kind: 'recordatorio_manual',
    });

    if (result?.success === false) {
      logger.error('[RECALL_ENVIO_FALLIDO]', { businessId: req.businessId, to: maskPhone(phone), via, status: result.status, metaCode: result.metaCode });
      return res.status(502).json({ success: false, error: 'WhatsApp no aceptó el mensaje. Intenta de nuevo más tarde.' });
    }

    logger.info('[RECALL_ENVIADO]', { businessId: req.businessId, to: maskPhone(phone), via });
    return res.json({ success: true, message: 'Recordatorio enviado.' });
  } catch (err) {
    logger.error(`clients.recallClient: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getAll, getOne, create, update, destroy, recallClient };
