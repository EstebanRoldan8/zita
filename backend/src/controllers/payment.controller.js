const { supabaseAdmin } = require('../config/supabase');
const { getPaymentProvider, PLAN_PRICES_COP } = require('../config/payments');
const { generateIntegritySignature, validateWebhookSignature, isPaymentAlreadyProcessed, activatePlanExtension } = require('../services/wompi.service');
const { notifyPaymentDeclined } = require('../services/notification.service');
const logger = require('../utils/logger');
const { logSystemAlert } = require('../utils/systemAlerts');

const PLAN_PRICES_BY_PERIOD = {
  lite: { monthly: 6000000, biannual: 32400000, annual: 57600000 },
  estandar: { monthly: 10000000, biannual: 54000000, annual: 96000000 },
  pro: { monthly: 15000000, biannual: 81000000, annual: 144000000 }
};

async function createSession(req, res) {
  try {
    const { plan, period = 'monthly', payment_method_type } = req.body;
    const businessId = req.businessId;

    if (!PLAN_PRICES_COP[plan]) {
      return res.status(400).json({ success: false, error: 'Plan inválido.' });
    }

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('plan, plan_expires_at, trial_ends_at, country')
      .eq('id', businessId)
      .single();

    const country = business?.country || 'colombia';
    const provider = getPaymentProvider(country);

    const ahora = new Date();
    const planActual = business?.plan || 'estandar';
    const planExpiresAt = business?.plan_expires_at;
    const trialEndsAt = business?.trial_ends_at;
    const tienePlanPagadoActivo = planExpiresAt && new Date(planExpiresAt) > ahora;
    const estaEnTrial = trialEndsAt && new Date(trialEndsAt) > ahora;
    const ORDEN_PLANES = { lite: 0, estandar: 1, pro: 2 };
    const esUpgrade = ORDEN_PLANES[plan] > ORDEN_PLANES[planActual];

    let amountInCents = PLAN_PRICES_BY_PERIOD[plan][period] || PLAN_PRICES_COP[plan];

    if (tienePlanPagadoActivo && !estaEnTrial && esUpgrade) {
      const expira = new Date(planExpiresAt);
      const diasRestantes = Math.ceil((expira - ahora) / (1000 * 60 * 60 * 24));
      const PRECIOS_DIA = {
        lite:     6000000  / 30,
        estandar: 10000000 / 30,
        pro:      15000000 / 30
      };
      const credito = Math.floor(PRECIOS_DIA[planActual] * diasRestantes);
      const costoNuevo = Math.floor(PRECIOS_DIA[plan] * diasRestantes);
      amountInCents = Math.max(costoNuevo - credito, 100);
    }
    const currency = 'COP';
    const reference = `ZITA-${businessId.slice(0, 8)}-${Date.now()}`;
    const integritySignature = generateIntegritySignature(
      reference,
      amountInCents,
      currency,
      provider.integritySecret
    );

    const { data: insertedPayment, error: insertError } = await supabaseAdmin
      .from('payments')
      .insert({
        business_id: businessId,
        plan,
        period,
        amount: amountInCents,
        currency,
        status: 'pending',
        payment_method: payment_method_type || null,
        wompi_reference: reference,
        country,
        provider: provider.provider,
      })
      .select('id')
      .single();

    if (insertError || !insertedPayment?.id) {
      logger.error('[PAYMENT_INSERT_FAILED]', { error: insertError?.message, businessId });
      await logSystemAlert('payment_insert_failed',
        `Falló inserción de pago para negocio ${businessId}`,
        businessId,
        { error: insertError?.message, plan, period, amount: amountInCents });
      return res.status(400).json({ success: false, error: 'No pudimos crear el pago, intenta de nuevo.' });
    }

    const redirectUrl = `${process.env.FRONTEND_URL}/dashboard/suscripcion?payment_ref=${reference}`;
    logger.info('[PAYMENT_REDIRECT]', { redirect_to: redirectUrl, payment_id: reference });

    return res.json({
      success: true,
      data: {
        reference,
        publicKey: provider.publicKey,
        amountInCents,
        currency,
        integritySignature,
        redirectUrl,
      },
    });
  } catch (err) {
    logger.error('payment.createSession error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al crear sesión de pago.' });
  }
}

async function handleWebhook(req, res) {
  let tx;
  try {
    const signature = req.headers['x-event-checksum'];
    const payload = req.body;
    const event = payload?.event;

    const country = 'colombia';
    const provider = getPaymentProvider(country);

    // CRÍTICO: Rechaza inmediatamente si NO hay firma O si la firma es inválida.
    // Esto es un error de VALIDACIÓN (petición malformada o no auténtica), no una
    // falla de servidor — Wompi no debe reintentar, por eso 403 y no 5xx.
    if (!signature || !validateWebhookSignature(payload, signature, provider.eventsSecret)) {
      logger.warn('Wompi webhook rechazado: firma faltante o inválida', { hasSignature: !!signature });
      return res.status(403).json({ received: false, error: 'Firma inválida o faltante' });
    }

    if (event === 'transaction.updated') {
      tx = payload?.data?.transaction;
      if (!tx) return res.status(400).json({ received: false, error: 'Payload malformado: falta data.transaction' });

      const { data: payment } = await supabaseAdmin
        .from('payments')
        .select('id, business_id, plan, period, amount, status, wompi_transaction_id, payment_method')
        .eq('wompi_reference', tx.reference)
        .single();

      if (!payment) return res.status(200).json({ received: true });

      // Idempotencia: si el payment ya fue procesado (status='approved'), es un reenvío duplicado
      const alreadyProcessed = await isPaymentAlreadyProcessed(payment.id);
      if (alreadyProcessed) {
        logger.info(`[WOMPI] Duplicado detectado: transaction ${tx.id} ya procesado`);

        // Sincroniza wompi_transaction_id y payment_method si faltaban
        const nuevoPaymentMethod = tx.payment_method?.type || null;
        if (payment.wompi_transaction_id !== tx.id || payment.payment_method !== nuevoPaymentMethod) {
          const { error: syncError } = await supabaseAdmin
            .from('payments')
            .update({
              wompi_transaction_id: tx.id,
              payment_method: nuevoPaymentMethod,
              updated_at: new Date().toISOString(),
            })
            .eq('id', payment.id)
            .eq('business_id', payment.business_id);

          if (syncError) {
            logger.error('payment.handleWebhook: error al sincronizar datos de duplicado', {
              payment_id: payment.id,
              business_id: payment.business_id,
              error: syncError.message
            });
          }
        }

        return res.json({ success: true, message: 'Already processed' });
      }

      const newStatus = tx.status === 'APPROVED' ? 'approved'
        : tx.status === 'DECLINED' ? 'declined'
        : tx.status === 'VOIDED' ? 'voided'
        : 'error';

      // ISSUE #5 (carrera real): update condicional con guard optimista sobre el
      // status leído (.eq('status', payment.status)). Si dos webhooks concurrentes
      // llegan casi al mismo tiempo, solo uno logra actualizar (0 filas afectadas
      // para el otro) y solo ese activa el plan — evita doble extensión.
      // Cross-tenant protection: también filtra por business_id.
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('payments')
        .update({
          status: newStatus,
          wompi_transaction_id: tx.id,
          payment_method: tx.payment_method?.type || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .eq('business_id', payment.business_id)
        .eq('status', payment.status)
        .select();

      if (updateError) {
        logger.error('payment.handleWebhook: error al actualizar payment', {
          payment_id: payment.id,
          business_id: payment.business_id,
          wompi_reference: tx.reference,
          error: updateError.message
        });
        // ISSUE #4: esto es una falla de servidor (BD), no de validación —
        // responde 5xx para que Wompi reintente el webhook.
        return res.status(500).json({ received: false, error: 'Error al procesar webhook' });
      }

      if (!updateData || updateData.length === 0) {
        // Carrera: otro proceso concurrente (webhook duplicado o reconciliación)
        // ya cambió el status entre nuestro SELECT y este UPDATE. No duplicar la activación.
        logger.info(`[WOMPI] Carrera detectada en payment ${payment.id}: status ya fue modificado por otro proceso, omitiendo activación duplicada`);
        return res.json({ success: true, message: 'Already processed' });
      }

      if (newStatus === 'approved') {
        await activatePlanExtension(payment.id);
      }

      if (newStatus === 'declined' || newStatus === 'error') {
        // La notificación al dueño no debe romper el webhook si falla
        // (WhatsApp caído, negocio sin teléfono, etc.) — Wompi solo necesita el 200.
        await logSystemAlert('payment_declined',
          `Pago rechazado/error para negocio ${payment.business_id}`,
          payment.business_id,
          { paymentId: payment.id, status: newStatus, decline_reason: tx.status_message || null });
        try {
          const { data: business } = await supabaseAdmin
            .from('businesses')
            .select('id, name, phone')
            .eq('id', payment.business_id)
            .single();

          if (business) {
            await notifyPaymentDeclined(business, {
              amount: payment.amount,
              decline_reason: tx.status_message || null
            });
          }
        } catch (notifError) {
          logger.error('[PAYMENT_DECLINED_NOTIFICATION] Error al notificar pago rechazado:', {
            payment_id: payment.id,
            business_id: payment.business_id,
            error: notifError.message
          });
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    // ISSUE #4: excepción real (BD caída, timeout, bug) — no un error de
    // validación. Responder 5xx para que Wompi reintente el webhook más tarde,
    // en vez de responder 200 y perder el evento silenciosamente.
    logger.error('[WOMPI_WEBHOOK_ERROR]', { error: err.message, wompi_transaction_id: tx?.id });
    await logSystemAlert('wompi_webhook_error',
      `Error procesando webhook de Wompi: ${err.message}`,
      null,
      { error: err.message, wompi_transaction_id: tx?.id });
    return res.status(500).json({ received: false, error: 'Error al procesar webhook' });
  }
}

async function getHistory(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('id, plan, amount, currency, status, payment_method, wompi_reference, created_at')
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('payment.getHistory error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al obtener historial.' });
  }
}

async function getStatus(req, res) {
  try {
    const { reference } = req.params;
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('id, plan, amount, currency, status, payment_method, wompi_reference, created_at, updated_at')
      .eq('wompi_reference', reference)
      .eq('business_id', req.businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado.' });
    }
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('payment.getStatus error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al consultar pago.' });
  }
}

async function adminGeneratePaymentLink(req, res) {
  try {
    const { id } = req.params;
    const { plan } = req.body;

    if (!PLAN_PRICES_COP[plan]) {
      return res.status(400).json({ success: false, error: 'Plan inválido.' });
    }

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('country')
      .eq('id', id)
      .single();

    const country = business?.country || 'colombia';
    const provider = getPaymentProvider(country);
    const amountInCents = PLAN_PRICES_COP[plan];
    const currency = 'COP';
    const reference = `ZITA-${id.slice(0, 8)}-${Date.now()}`;
    const integritySignature = generateIntegritySignature(reference, amountInCents, currency, provider.integritySecret);

    const { data: insertedPayment, error: insertError } = await supabaseAdmin
      .from('payments')
      .insert({
        business_id: id,
        plan,
        amount: amountInCents,
        currency,
        status: 'pending',
        wompi_reference: reference,
        country,
        provider: provider.provider,
      })
      .select('id')
      .single();

    if (insertError || !insertedPayment?.id) {
      logger.error('[PAYMENT_INSERT_FAILED]', { error: insertError?.message, businessId: id });
      return res.status(400).json({ success: false, error: 'No pudimos crear el pago, intenta de nuevo.' });
    }

    const checkoutUrl =
      `https://checkout.wompi.co/p/?` +
      `public-key=${provider.publicKey}` +
      `&currency=${currency}` +
      `&amount-in-cents=${amountInCents}` +
      `&reference=${reference}` +
      `&signature:integrity=${integritySignature}`;

    return res.json({ success: true, data: { checkoutUrl, reference, amountInCents, currency } });
  } catch (err) {
    logger.error('payment.adminGeneratePaymentLink error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al generar link de pago.' });
  }
}

async function calculatePayment(req, res) {
  try {
    const { plan, period = 'monthly' } = req.body;
    const businessId = req.businessId;

    if (!PLAN_PRICES_BY_PERIOD[plan]) {
      return res.status(400).json({ success: false, error: 'Plan inválido.' });
    }

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('plan, plan_expires_at, trial_ends_at')
      .eq('id', businessId)
      .single();

    const ahora = new Date();
    const planActual = business?.plan || 'estandar';
    const planExpiresAt = business?.plan_expires_at;
    const trialEndsAt = business?.trial_ends_at;
    const tienePlanPagadoActivo = planExpiresAt && new Date(planExpiresAt) > ahora;
    const estaEnTrial = trialEndsAt && new Date(trialEndsAt) > ahora;

    const ORDEN_PLANES = { lite: 0, estandar: 1, pro: 2 };
    const esUpgrade = ORDEN_PLANES[plan] > ORDEN_PLANES[planActual];
    const esMismoPlan = plan === planActual;
    const esDowngrade = ORDEN_PLANES[plan] < ORDEN_PLANES[planActual];

    const costoCompleto = PLAN_PRICES_BY_PERIOD[plan][period];
    let amountInCents = costoCompleto;
    let tipo;
    let diasRestantes = 0;
    let credito = 0;

    if (esDowngrade) {
      const fechaVencimiento = planExpiresAt
        ? new Date(planExpiresAt).toLocaleDateString('es-CO')
        : null;
      return res.json({
        success: true,
        data: {
          tipo: 'downgrade',
          planActual,
          planNuevo: plan,
          fechaVencimiento,
          requierePago: false,
          mensaje: fechaVencimiento
            ? `El cambio a Plan ${plan} aplicará el ${fechaVencimiento} cuando venza tu plan actual. Sin cobro adicional.`
            : 'El cambio aplicará cuando venza tu plan actual. Sin cobro adicional.'
        }
      });
    }

    const PRECIOS_DIA = {
      lite:     6000000  / 30,
      estandar: 10000000 / 30,
      pro:      15000000 / 30
    };

    if (!tienePlanPagadoActivo || estaEnTrial) {
      tipo = estaEnTrial ? 'trial_to_paid' : 'nuevo';
      amountInCents = costoCompleto;
      diasRestantes = 0;
      credito = 0;
    } else if (esMismoPlan) {
      tipo = 'renovacion';
      amountInCents = costoCompleto;
      const expira = new Date(planExpiresAt);
      diasRestantes = Math.ceil((expira - ahora) / (1000 * 60 * 60 * 24));
      credito = 0;
    } else if (esUpgrade) {
      tipo = 'upgrade';
      const expira = new Date(planExpiresAt);
      diasRestantes = Math.ceil((expira - ahora) / (1000 * 60 * 60 * 24));
      credito = Math.floor(PRECIOS_DIA[planActual] * diasRestantes);
      const costoNuevo = Math.floor(PRECIOS_DIA[plan] * diasRestantes);
      amountInCents = Math.max(costoNuevo - credito, 100);
    }

    const diasTrialRestantes = estaEnTrial
      ? Math.ceil((new Date(trialEndsAt) - ahora) / (1000 * 60 * 60 * 24))
      : 0;

    const mensajes = {
      trial_to_paid: `Tienes ${diasTrialRestantes} días de período de prueba restantes. Al pagar, tu plan se activa y los días de período de prueba se respetan.`,
      nuevo: `Activa tu plan por ${period === 'monthly' ? '1 mes' : period === 'biannual' ? '6 meses' : '1 año'}.`,
      renovacion: `Tu plan vence en ${diasRestantes} días. Al pagar ahora, se extiende ${period === 'monthly' ? '30 días' : period === 'biannual' ? '6 meses' : '1 año'} desde esa fecha.`,
      upgrade: `Tienes ${diasRestantes} días restantes de tu plan actual. Se aplica un crédito de $${Math.round(credito / 100).toLocaleString('es-CO')} y pagas solo la diferencia.`
    };

    return res.json({
      success: true,
      data: {
        tipo,
        planActual,
        planNuevo: plan,
        period,
        amountInCents,
        amountCOP: Math.round(amountInCents / 100),
        costoCompletoCOP: Math.round(costoCompleto / 100),
        creditoCOP: Math.round(credito / 100),
        diasRestantes,
        requierePago: true,
        estaEnTrial,
        mensaje: mensajes[tipo] || ''
      }
    });
  } catch (err) {
    logger.error('payment.calculatePayment error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al calcular pago.' });
  }
}

async function scheduleDowngrade(req, res) {
  try {
    const { plan } = req.body;
    const businessId = req.businessId;

    const ORDEN_PLANES = { lite: 0, estandar: 1, pro: 2 };

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('plan, plan_expires_at')
      .eq('id', businessId)
      .single();

    if (!business) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado.' });
    }

    if (ORDEN_PLANES[plan] >= ORDEN_PLANES[business.plan]) {
      return res.status(400).json({ success: false, error: 'Solo puedes programar un downgrade a un plan inferior.' });
    }

    const { data: downgradeData, error: downgradeError } = await supabaseAdmin
      .from('scheduled_downgrades')
      .upsert({
        business_id: businessId,
        new_plan: plan,
        applies_at: business.plan_expires_at,
        created_at: new Date().toISOString()
      }, { onConflict: 'business_id' })
      .select('business_id');

    if (downgradeError || !downgradeData || downgradeData.length === 0) {
      logger.error('[SCHEDULE_DOWNGRADE_UPSERT_FAILED]', { businessId, plan, error: downgradeError?.message });
      return res.status(500).json({ success: false, error: 'No se pudo programar el downgrade.' });
    }

    return res.json({
      success: true,
      data: {
        message: `Tu plan cambiará a ${plan} el ${new Date(business.plan_expires_at).toLocaleDateString('es-CO')}.`
      }
    });
  } catch (err) {
    logger.error('payment.scheduleDowngrade error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al programar cambio de plan.' });
  }
}

module.exports = {
  createSession,
  handleWebhook,
  getHistory,
  getStatus,
  adminGeneratePaymentLink,
  calculatePayment,
  scheduleDowngrade
};
