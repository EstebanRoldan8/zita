const { supabaseClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

async function register(req, res) {
  try {
    const { ownerName, name, email, password, business_type = 'barberia', phone, ciudad, country = 'colombia' } = req.body;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already been registered')) {
        return res.status(409).json({ success: false, error: 'Ya existe una cuenta con ese email.' });
      }
      logger.error(`register auth error: ${authError.message}`);
      return res.status(400).json({ success: false, error: authError.message });
    }

    const trialDays = parseInt(process.env.TRIAL_DAYS) || 30;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: business, error: businessError } = await supabaseAdmin
      .from('businesses')
      .insert({
        user_id: authData.user.id,
        name,
        owner_name: ownerName || name,
        owner_email: email,
        business_type,
        phone: phone || null,
        address: ciudad || null,
        country: country || 'colombia',
        trial_ends_at: trialEndsAt,
      })
      .select()
      .single();

    if (businessError) {
      // Si falla la creación del negocio, elimina el usuario para evitar inconsistencias
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      logger.error(`register business error: ${businessError.message}`);
      return res.status(500).json({ success: false, error: 'Error al crear el negocio.' });
    }

    return res.status(201).json({
      success: true,
      data: {
        user: { id: authData.user.id, email: authData.user.email, created_at: authData.user.created_at },
        business
      },
    });
  } catch (err) {
    logger.error(`register: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      return res.status(401).json({ success: false, error: 'Email o contraseña incorrectos.' });
    }

    const { data: business, error: businessError } = await supabaseClient
      .from('businesses')
      .select('id, name, business_type, status')
      .eq('user_id', authData.user.id)
      .single();

    if (businessError) {
      logger.error(`login business lookup: ${businessError.message}`);
    }

    return res.json({
      success: true,
      data: {
        session: authData.session,
        user: { id: authData.user.id, email: authData.user.email, created_at: authData.user.created_at },
        business: business || null,
      },
    });
  } catch (err) {
    logger.error(`login: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function logout(req, res) {
  try {
    await supabaseClient.auth.signOut();
    return res.json({ success: true, data: null });
  } catch (err) {
    logger.error(`logout: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { register, login, logout };
