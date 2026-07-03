const { supabaseAdmin } = require('../config/supabase');
const { getPaymentProvider, PLAN_PRICES_COP } = require('../config/payments');
const { generateIntegritySignature, validateWebhookSignature } = require('../services/wompi.service');
const logger = require('../utils/logger');

const PLAN_PRICES_BY_PERIOD = {
  lite: { monthly: 6000000, biannual: 32400000, annual: 57600000 },
  estandar: { monthly: 10000000, biannual: 54000000, annual: 96000000 },
  pro: { monthly: 15000000, biannual: 81000000, annual: 144000000 }
};

const PERIOD_DAYS = {
  monthly: 30,
  biannual: 180,
  annual: 365
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

    await supabaseAdmin.from('payments').insert({
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
    });

    return res.json({
      success: true,
      data: {
        reference,
        publicKey: provider.publicKey,
        amountInCents,
        currency,
        integritySignature,
        redirectUrl: `${process.env.FRONTEND_URL}/dashboard/suscripcion?ref=${reference}`,
      },
    });
  } catch (err) {
    logger.error('payment.createSession error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al crear sesión de pago.' });
  }
}

async function handleWebhook(req, res) {
  try {
    const signature = req.headers['x-event-checksum'];
    const payload = req.body;
    const event = payload?.event;

    const country = 'colombia';
    const provider = getPaymentProvider(country);

    // CRÍTICO: Rechaza inmediatamente si NO hay firma O si la firma es inválida
    if (!signature || !validateWebhookSignature(payload, signature, provider.eventsSecret)) {
      logger.warn('Wompi webhook rechazado: firma faltante o inválida', { hasSignature: !!signature });
      return res.status(403).json({ received: false, error: 'Firma inválida o faltante' });
    }

    if (event === 'transaction.updated') {
      const tx = payload?.data?.transaction;
      if (!tx) return res.status(200).json({ received: true });

      const { data: payment } = await supabaseAdmin
        .from('payments')
        .select('id, business_id, plan, period')
        .eq('wompi_reference', tx.reference)
        .single();

      if (!payment) return res.status(200).json({ received: true });

      const newStatus = tx.status === 'APPROVED' ? 'approved'
        : tx.status === 'DECLINED' ? 'declined'
        : tx.status === 'VOIDED' ? 'voided'
        : 'error';

      // FIX 2: Agregar cross-tenant protection — verifica business_id
      // FIX 3: Captura error y retorna 500 si falla
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('payments')
        .update({
          status: newStatus,
          wompi_transaction_id: tx.id,
          payment_method: tx.payment_method?.type || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .eq('business_id', payment.business_id); // FIX 2: Protección cross-tenant

      if (updateError) {
        logger.error('payment.handleWebhook: error al actualizar payment', {
          payment_id: payment.id,
          business_id: payment.business_id,
          wompi_reference: tx.reference,
          error: updateError.message
        });
        return res.status(500).json({ received: false, error: 'Error al procesar webhook' });
      }

      if (newStatus === 'approved') {
        const { data: business } = await supabaseAdmin
          .from('businesses')
          .select('plan_expires_at')
          .eq('id', payment.business_id)
          .single();

        const period = payment.period || 'monthly';
        const days = PERIOD_DAYS[period] || 30;
        const baseDate = business?.plan_expires_at && new Date(business.plan_expires_at) > new Date()
          ? new Date(business.plan_expires_at)
          : new Date();

        const expiresAt = new Date(baseDate);
        expiresAt.setDate(expiresAt.getDate() + days);

        await supabaseAdmin
          .from('businesses')
          .update({ plan: payment.plan, plan_expires_at: expiresAt.toISOString() })
          .eq('id', payment.business_id);

        await supabaseAdmin
          .from('scheduled_downgrades')
          .delete()
          .eq('business_id', payment.business_id);

        logger.info(`Plan activado: business=${payment.business_id} plan=${payment.plan} period=${period}`);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('payment.handleWebhook error:', { message: err.message });
    return res.status(200).json({ received: true });
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

    await supabaseAdmin.from('payments').insert({
      business_id: id,
      plan,
      amount: amountInCents,
      currency,
      status: 'pending',
      wompi_reference: reference,
      country,
      provider: provider.provider,
    });

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

    await supabaseAdmin
      .from('scheduled_downgrades')
      .upsert({
        business_id: businessId,
        new_plan: plan,
        applies_at: business.plan_expires_at,
        created_at: new Date().toISOString()
      }, { onConflict: 'business_id' });

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
