const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { accessStatusFor, removeEmployeeAccess } = require('./invitations.controller');
const { notify } = require('../services/whatsappNotify');
const { businessSender } = require('../services/businessSender');
const { maskPhone } = require('../utils/phone');
const { fechaHoraCita } = require('../services/cancellationNotice');

// Aviso al cliente de que su cita pasó a otro empleado. Sale del número del negocio con su token
// (nunca otro número; sin número o sin token no sale y queda en el log). Dentro de la ventana de 24 h:
// texto libre; fuera, plantilla aviso_cita_reasignada (si WA_TEMPLATES_ENABLED). Nunca lanza.
async function notifyReassignment({ business, businessId, cita, newEmployeeName }) {
  try {
    const phone = cita?.clients?.phone;
    if (!phone) return;
    if (!business?.whatsapp_access_token) {
      logger.warn('[WA_SIN_TOKEN] el negocio no tiene WhatsApp conectado; no se envía', { businessId, context: 'cita_reasignada' });
      return;
    }
    const sender = businessSender(business, { businessId, context: 'cita_reasignada' }); // sin número: log WA_SIN_NUMERO
    if (!sender) return;
    const servicio = cita.services?.name || 'servicio';
    const fechaFormato = new Date(cita.scheduled_at).toLocaleString('es-CO', {
      timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    const mensaje = `Tu cita de ${servicio} el ${fechaFormato} ahora será atendida por ${newEmployeeName} 😊`;
    const { fecha, hora } = fechaHoraCita(cita.scheduled_at, business.country);
    const { result } = await notify({
      to: phone, text: mensaje, token: sender.token, phoneNumberId: sender.phoneNumberId, businessId, kind: 'cita_reasignada',
      // Fuera de la ventana: {{1}} cliente · {{2}} servicio · {{3}} fecha y hora · {{4}} negocio · {{5}} nuevo empleado
      template: { key: 'aviso_cita_reasignada', body: [cita.clients?.name, servicio, `${fecha} a las ${hora}`, business.name, newEmployeeName] },
    });
    if (result?.success === false) {
      logger.warn('[REASIGNACION_AVISO_FALLIDO]', { appointmentId: cita.id, to: maskPhone(phone), status: result.status });
    }
  } catch (err) {
    logger.warn(`WhatsApp notification failed for appointment ${cita?.id}: ${err.message}`);
  }
}

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

    // Estado del acceso al panel (sin exponer user_id). Si la migración 066 no corrió, todos 'none'.
    let statuses = {};
    try {
      statuses = await accessStatusFor(req.businessId, data || []);
    } catch (statusErr) {
      logger.warn(`employees.getAll: access_status no disponible - ${statusErr.message}`);
    }
    const withAccess = (data || []).map((e) => ({ ...e, access_status: statuses[e.id] || 'none' }));
    return res.json({ success: true, data: withAccess });
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
    const { getAvailableEmployee, localParts } = require('../utils/availability');

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
      // Verificar si hay otros empleados activos (validación temprana rápida)
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

      // === FASE A: VALIDACIÓN COMPLETA (sin cambios en BD) ===
      // Para CADA cita futura, verificar que existe reemplazo disponible
      const reassignmentMap = new Map(); // Mapea cita.id -> nuevoEmpleado
      const failedCitas = []; // Citas que no pudieron reasignarse

      for (const cita of futureCitas) {
        // Hora local de Colombia (el timestamptz llega en UTC) y duración real del servicio
        const { fecha, hora } = localParts(cita.scheduled_at);

        // (sin excluir la cita: así el empleado que se elimina sigue ocupado en ese horario y no se reelige)
        const nuevoEmpleado = await getAvailableEmployee(req.businessId, fecha, hora, cita.services?.duration_minutes || 30);

        if (nuevoEmpleado) {
          reassignmentMap.set(cita.id, nuevoEmpleado);
        } else {
          // Registrar fallo detallado para error message
          const fechaFormato = new Date(cita.scheduled_at).toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          failedCitas.push({
            fecha: fechaFormato,
            cliente: cita.clients?.name || 'Cliente desconocido',
            servicio: cita.services?.name || 'servicio'
          });
        }
      }

      // Si CUALQUIER cita no tiene reemplazo, ABORTAR TODO (no cambiar nada en BD)
      if (failedCitas.length > 0) {
        const detalles = failedCitas
          .map(c => `- ${c.fecha}: ${c.cliente} (${c.servicio})`)
          .join('\n');
        return res.status(409).json({
          success: false,
          error: `No se puede eliminar: las siguientes citas no tienen otro empleado disponible en su horario. Cancela o reagenda primero:\n${detalles}`
        });
      }

      // === FASE B: EJECUCIÓN (solo si Fase A pasó sin errores) ===
      const business = require('../config/supabase').supabaseAdmin;
      const { data: bizData } = await business
        .from('businesses')
        .select('name, country, whatsapp_phone_number_id, whatsapp_access_token')
        .eq('id', req.businessId)
        .single();

      for (const cita of futureCitas) {
        const nuevoEmpleado = reassignmentMap.get(cita.id);

        if (nuevoEmpleado) {
          // Actualizar cita y verificar que se afectó 1 fila
          const { data: updateResult, error: updateError } = await userClient
            .from('appointments')
            .update({ employee_id: nuevoEmpleado.id })
            .eq('id', cita.id)
            .select('id');

          if (updateError || !updateResult || updateResult.length === 0) {
            logger.error('[REASSIGNMENT_UPDATE_FAILED]', { appointment_id: cita.id, error: updateError?.message });
          } else {
            // Aviso al cliente desde el número del negocio (notify: ventana de 24 h)
            await notifyReassignment({ business: bizData, businessId: req.businessId, cita, newEmployeeName: nuevoEmpleado.name });
          }
        }
      }
    }

    // Quitar acceso al panel (invitaciones, vínculo y cuenta) antes de borrar la fila
    await removeEmployeeAccess(req.businessId, id);

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

module.exports = { getAll, create, update, deleteEmployee, notifyReassignment };
