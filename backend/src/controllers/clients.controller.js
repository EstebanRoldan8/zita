const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/encrypt');
const { sendMessage } = require('../config/whatsapp');

async function getAll(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    // 1. Traer todos los clientes
    const { data: clients, error: clientsError } = await userClient
      .from('clients')
      .select('id, name, phone, email, created_at')
      .eq('business_id', req.businessId)
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

    if (withStats.length > 0) {
      logger.info(`clients.getAll: first client complete object: ${JSON.stringify(withStats[0])}`);
      logger.info(`clients.getAll: first client total_visits = ${withStats[0].total_visits}`);
    }

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
      .select('id, name, phone, email, created_at')
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
    const { data, error } = await userClient
      .from('clients')
      .insert({ business_id: req.businessId, name, phone, email })
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

    const { name, phone, email } = req.body;

    const updates = {};
    if (name  !== undefined) updates.name  = name?.trim() || null;
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (email !== undefined) updates.email = email?.trim() || null;

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

async function recallClient(req, res) {
  try {
    logger.info('Recall iniciado: ' + req.params.id);
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
      .select('name, recall_message, recall_image_url, whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', req.businessId)
      .single();

    if (businessError || !business) {
      return res.status(500).json({ success: false, error: 'Error al obtener datos del negocio.' });
    }

    logger.info('Negocio recall: ' + JSON.stringify({
      name: business?.name,
      hasToken: !!business?.whatsapp_access_token,
      phoneNumberId: business?.whatsapp_phone_number_id
    }));

    let phone = client.phone.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '57' + phone.slice(1);
    if (!phone.startsWith('57') && phone.length === 10) {
      phone = '57' + phone;
    }

    const DEFAULT_MESSAGE = 'Hola {nombre} 👋 Hace un tiempo no te vemos en {negocio}. ¡Te esperamos para tu próxima visita! Escríbenos para agendar fácilmente 😊';
    const recallMessage = business.recall_message || DEFAULT_MESSAGE;

    const mensajeFinal = recallMessage
      .replace('{nombre}', client.name)
      .replace('{negocio}', business.name);

    logger.info('Mensaje completo: ' + mensajeFinal);

    const token = decrypt(business.whatsapp_access_token);
    logger.info('Token OK: ' + !!token);
    logger.info('Recall params: ' + JSON.stringify({
      to: phone,
      message: mensajeFinal,
      phoneNumberId: business.whatsapp_phone_number_id
    }));

    try {
      if (business.recall_image_url) {
        logger.info('Enviando imagen: ' + business.recall_image_url);
      }

      await sendMessage(
        phone,
        mensajeFinal,
        token,
        business.whatsapp_phone_number_id
      );

      return res.json({ success: true, message: 'Recordatorio enviado.' });
    } catch (waError) {
      logger.error('Recall ERROR: ' + waError.message);
      logger.error('Stack: ' + waError.stack);
      return res.status(500).json({ success: false, error: waError.message || 'Error al enviar recordatorio por WhatsApp.' });
    }
  } catch (err) {
    logger.error(`clients.recallClient: ${err.message}`);
    logger.error('Stack: ' + err.stack);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getAll, getOne, create, update, recallClient };
