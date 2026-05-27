const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

async function getMetrics(req, res) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      { count: totalBusinesses },
      { count: todayAppointments },
      { data: byStatus },
    ] = await Promise.all([
      supabaseAdmin.from('businesses').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .gte('scheduled_at', todayStart.toISOString())
        .lte('scheduled_at', todayEnd.toISOString()),
      supabaseAdmin.from('businesses').select('status'),
    ]);

    const statusCount = (byStatus || []).reduce((acc, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        total_businesses: totalBusinesses || 0,
        today_appointments: todayAppointments || 0,
        active: statusCount['active'] || 0,
        trial: statusCount['trial'] || 0,
        suspended: statusCount['suspended'] || 0,
      },
    });
  } catch (err) {
    logger.error(`admin.getMetrics: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getBusinesses(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('businesses')
      .select('id, name, owner_email, business_type, status, phone, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error(`admin.getBusinesses: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getBusinessDetail(req, res) {
  try {
    const { id } = req.params;

    const [
      { data: business, error: bizError },
      { count: clientsCount },
      { count: servicesCount },
      { count: appointmentsCount },
      { data: recentAppointments },
    ] = await Promise.all([
      supabaseAdmin
        .from('businesses')
        .select('id, name, owner_email, business_type, status, phone, address, created_at')
        .eq('id', id)
        .single(),
      supabaseAdmin
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', id),
      supabaseAdmin
        .from('services')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', id)
        .eq('active', true),
      supabaseAdmin
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', id),
      supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, price, clients(name), services(name)')
        .eq('business_id', id)
        .order('scheduled_at', { ascending: false })
        .limit(10),
    ]);

    if (bizError) throw bizError;

    return res.json({
      success: true,
      data: {
        ...business,
        stats: {
          clients: clientsCount || 0,
          services: servicesCount || 0,
          appointments: appointmentsCount || 0,
        },
        recent_appointments: recentAppointments || [],
      },
    });
  } catch (err) {
    logger.error(`admin.getBusinessDetail: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateBusiness(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['trial', 'active', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado no válido. Usa: trial, active o suspended.' });
    }

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`admin.updateBusiness: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getConversationDetail(req, res) {
  try {
    const { id } = req.params;

    const { data: messages, error } = await supabaseAdmin
      .from('support_messages')
      .select('id, sender, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return res.json({ success: true, data: messages || [] });
  } catch (err) {
    logger.error(`admin.getConversationDetail: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getNotifications(req, res) {
  try {
    const { type } = req.query;
    let query = supabaseAdmin
      .from('notifications')
      .select('id, business_id, type, message, metadata, read, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) throw error;

    const enrichedData = await Promise.all((data || []).map(async (notif) => {
      if (notif.business_id) {
        const { data: business } = await supabaseAdmin
          .from('businesses')
          .select('name')
          .eq('id', notif.business_id)
          .single();
        return { ...notif, business_name: business?.name || 'Desconocido' };
      }
      return { ...notif, business_name: 'Desconocido' };
    }));

    return res.json({ success: true, data: enrichedData || [] });
  } catch (err) {
    logger.error(`admin.getNotifications: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function markNotificationRead(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('id', id);

    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    logger.error(`admin.markNotificationRead: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function changePlan(req, res) {
  try {
    const { id } = req.params;
    const { plan } = req.body;

    const { PLANS } = require('../config/plans');

    if (!['lite', 'estandar', 'pro'].includes(plan)) {
      return res.status(400).json({
        success: false,
        error: 'Plan inválido'
      });
    }

    const { error } = await supabaseAdmin
      .from('businesses')
      .update({
        plan,
        plan_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true, data: { plan } });
  } catch (err) {
    logger.error(`admin.changePlan: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = {
  getMetrics,
  getBusinesses,
  getBusinessDetail,
  updateBusiness,
  getConversationDetail,
  getNotifications,
  markNotificationRead,
  changePlan,
};
