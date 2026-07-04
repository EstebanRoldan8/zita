const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const capitalizeName = (str) => str.trim().replace(/\b\w/g, c => c.toUpperCase());

async function getAll(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { includeInactive } = req.query;

    let query = userClient
      .from('employees')
      .select('id, name, email, phone, commission_percent, is_active, created_at')
      .eq('business_id', req.businessId);

    if (includeInactive !== 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('name');

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`employees.getAll: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function create(req, res) {
  try {
    const body = req.body;
    let { name, email, phone, commission_percent } = body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'El nombre es obligatorio.' });
    }

    if (body.name) body.name = capitalizeName(body.name);
    name = body.name;

    const { PLANS } = require('../config/plans');

    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('plan')
      .eq('id', req.businessId)
      .single();

    const plan = biz.plan || 'estandar';
    const limite = PLANS[plan].max_employees;

    if (limite !== -1) {
      const { count } = await supabaseAdmin
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', req.businessId)
        .eq('is_active', true);

      if (count >= limite) {
        return res.status(403).json({
          success: false,
          error: `Alcanzaste el límite de ${limite} empleados de tu plan ${PLANS[plan].name}. Mejora tu plan para agregar más.`,
          code: 'EMPLOYEES_LIMIT_REACHED'
        });
      }
    }

    const userClient = createUserClient(req.headers.authorization);
    const { data, error } = await userClient
      .from('employees')
      .insert({ business_id: req.businessId, name, email, phone, commission_percent })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`employees.create: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const { name, email, phone, commission_percent, is_active } = req.body;

    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('employees')
      .select('id, is_active')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    // Validar límite de empleados al reactivar
    if (is_active === true && !existing.is_active) {
      try {
        const { PLANS } = require('../config/plans');

        const { data: biz, error: bizError } = await supabaseAdmin
          .from('businesses')
          .select('plan')
          .eq('id', req.businessId)
          .single();

        if (bizError) throw bizError;

        const plan = biz.plan || 'estandar';
        const limite = PLANS[plan].max_employees;

        if (limite !== -1) {
          const { count, error: countError } = await supabaseAdmin
            .from('employees')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', req.businessId)
            .eq('is_active', true)
            .neq('id', id);

          if (countError) throw countError;

          if (count >= limite) {
            return res.status(403).json({
              success: false,
              error: `Alcanzaste el límite de ${limite} empleados de tu plan ${PLANS[plan].name}. Mejora tu plan para agregar más.`,
              code: 'EMPLOYEES_LIMIT_REACHED'
            });
          }
        }
      } catch (validationErr) {
        logger.error(`employees.update validation error: ${validationErr.message}`);
        return res.status(500).json({ success: false, error: 'Error al validar límite de empleados.' });
      }
    }

    const updates = {};
    if (name !== undefined) {
      updates.name = capitalizeName(name);
    }
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (commission_percent !== undefined) updates.commission_percent = commission_percent;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await userClient
      .from('employees')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`employees.update: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function deleteEmployee(req, res) {
  try {
    const { id } = req.params;
    const userClient = createUserClient(req.headers.authorization);
    const { getAvailableEmployee } = require('../utils/availability');
    const { sendMessage } = require('../config/whatsapp');
    const { decrypt } = require('../utils/encrypt');

    // Verificar que el empleado existe
    const { data: existing, error: getErr } = await userClient
      .from('employees')
      .select('id, name')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (getErr || !existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    // Buscar citas futuras del empleado
    const { data: futureCitas } = await userClient
      .from('appointments')
      .select('id, scheduled_at, services(name, duration_minutes), clients(phone, name)')
      .eq('employee_id', id)
      .in('status', ['pending', 'confirmed'])
      .gt('scheduled_at', new Date().toISOString())
      .order('scheduled_at');

    if (futureCitas && futureCitas.length > 0) {
      // Verificar si hay otros empleados activos
      const { data: otherEmployees } = await userClient
        .from('employees')
        .select('id')
        .eq('business_id', req.businessId)
        .eq('is_active', true)
        .neq('id', id)
        .limit(1);

      if (!otherEmployees || otherEmployees.length === 0) {
        return res.status(409).json({
          success: false,
          error: 'No puedes eliminar al único empleado con citas futuras agendadas. Cancela o reagenda esas citas primero.'
        });
      }

      // Reasignar cada cita futura
      const business = require('../config/supabase').supabaseAdmin;
      const { data: bizData } = await business
        .from('businesses')
        .select('whatsapp_phone_number_id, whatsapp_access_token')
        .eq('id', req.businessId)
        .single();

      for (const cita of futureCitas) {
        const fecha = cita.scheduled_at.split('T')[0];
        const hora = cita.scheduled_at.split('T')[1].slice(0, 5);

        // Reasignar automáticamente
        const nuevoEmpleado = await getAvailableEmployee(req.businessId, fecha, hora);

        if (nuevoEmpleado) {
          await userClient
            .from('appointments')
            .update({ employee_id: nuevoEmpleado.id })
            .eq('id', cita.id);

          // Notificar al cliente por WhatsApp
          if (cita.clients?.phone) {
            const fechaFormato = new Date(cita.scheduled_at).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit'
            });
            const mensaje = `Tu cita de ${cita.services?.name || 'servicio'} el ${fechaFormato} ahora será atendida por ${nuevoEmpleado.name} 😊`;

            try {
              const token = bizData?.whatsapp_access_token
                ? decrypt(bizData.whatsapp_access_token)
                : process.env.WHATSAPP_ACCESS_TOKEN;

              await sendMessage(
                cita.clients.phone,
                mensaje,
                token,
                bizData?.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID
              );
            } catch (whatsappErr) {
              logger.warn(`WhatsApp notification failed for appointment ${cita.id}: ${whatsappErr.message}`);
            }
          }
        }
      }
    }

    // Eliminar empleado
    const { data, error } = await userClient
      .from('employees')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }
    return res.json({ success: true, data: { id } });
  } catch (err) {
    logger.error(`employees.deleteEmployee: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error al eliminar empleado.' });
  }
}

module.exports = { getAll, create, update, deleteEmployee };
