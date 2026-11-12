// Invitación de empleados al panel por enlace (el dueño la comparte desde su propio WhatsApp;
// el backend NO envía nada por la API de Meta).
//   POST   /api/employees/:id/invite         (dueño)   genera enlace de un solo uso, 7 días
//   DELETE /api/employees/:id/access         (dueño)   revoca acceso y borra la cuenta del empleado
//   GET    /api/invitations/:token           (público) solo valida, NO consume el token
//   POST   /api/invitations/:token/accept    (público) crea la cuenta y la vincula, una sola vez
// Solo se guarda el SHA-256 del token. Nunca se loguea el token, su hash ni el correo completo.
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { normalizeColombianPhone, maskEmail } = require('../utils/phone');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const GENERIC_INVALID = 'Este enlace de invitación no es válido o ya expiró. Pídele al dueño del negocio uno nuevo.';
const MIGRATION_MISSING = 'La función de invitaciones aún no está habilitada (falta correr la migración 066).';

const hashToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

// Comparación en tiempo constante del hash guardado contra el calculado
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

const invalid = (res) => res.status(400).json({ success: false, error: GENERIC_INVALID, code: 'INVITE_INVALID' });
const noStore = (res) => res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
const isMissingSchema = (e) => !!e && (e.code === '42P01' || e.code === '42703');

// Busca una invitación vigente por token. null si no existe, está usada, revocada o vencida,
// o si el empleado ya no está activo o ya tiene cuenta. El motivo nunca se expone.
async function findValidInvite(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  const { data: inv, error } = await supabaseAdmin
    .from('employee_invites')
    .select('id, business_id, employee_id, token_hash, expires_at, used_at, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle();
  if (error || !inv || !sameHash(inv.token_hash, hash)) return null;
  if (inv.used_at || inv.revoked_at || !(Date.parse(inv.expires_at) > Date.now())) return null;

  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id, name, business_id, is_active, user_id, businesses(id, name)')
    .eq('id', inv.employee_id)
    .eq('business_id', inv.business_id)
    .maybeSingle();
  if (!emp || !emp.is_active || emp.user_id || !emp.businesses) return null;
  return { invite: inv, employee: emp, businessName: emp.businesses.name };
}

// Revoca las invitaciones pendientes del empleado
async function revokePending(businessId, employeeId) {
  return supabaseAdmin
    .from('employee_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .is('used_at', null)
    .is('revoked_at', null);
}

// Borra la cuenta de Auth del empleado si no es dueño de ningún negocio (para poder re-invitarlo)
async function deleteAuthUserIfOnlyEmployee(userId) {
  if (!userId) return;
  try {
    const { data: owned } = await supabaseAdmin.from('businesses').select('id').eq('user_id', userId).limit(1);
    if (owned && owned.length) return;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) logger.warn('[EMPLOYEE_ACCOUNT_DELETE_FAILED]', { error: error.message });
  } catch (err) {
    logger.warn('[EMPLOYEE_ACCOUNT_DELETE_FAILED]', { error: err.message });
  }
}

// Quita el acceso de un empleado: invitaciones pendientes, vínculo y cuenta. Tolerante a la migración 066 sin correr.
async function removeEmployeeAccess(businessId, employeeId) {
  const { error: revErr } = await revokePending(businessId, employeeId);
  if (revErr && !isMissingSchema(revErr)) throw revErr;

  const { data: emp, error: empErr } = await supabaseAdmin
    .from('employees').select('id, user_id').eq('id', employeeId).eq('business_id', businessId).maybeSingle();
  if (isMissingSchema(empErr)) return { hadAccount: false };
  if (empErr) throw empErr;
  if (!emp?.user_id) return { hadAccount: false };

  const { error: unlinkErr } = await supabaseAdmin
    .from('employees').update({ user_id: null }).eq('id', employeeId).eq('business_id', businessId);
  if (unlinkErr) throw unlinkErr;

  await deleteAuthUserIfOnlyEmployee(emp.user_id);
  return { hadAccount: true };
}

// Estado de acceso por empleado para la pantalla Empleados: 'none' | 'invited' | 'active'
async function accessStatusFor(businessId, employees) {
  const out = Object.fromEntries((employees || []).map((e) => [e.id, 'none']));
  if (!employees?.length) return out;
  const ids = employees.map((e) => e.id);

  const { data: linked, error: lErr } = await supabaseAdmin
    .from('employees').select('id, user_id').eq('business_id', businessId).in('id', ids);
  if (lErr) return out; // migración 066 sin correr: todos "sin acceso"
  const active = new Set((linked || []).filter((e) => e.user_id).map((e) => e.id));

  const { data: pending, error: pErr } = await supabaseAdmin
    .from('employee_invites')
    .select('employee_id, expires_at')
    .eq('business_id', businessId)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString());
  const invited = new Set(pErr ? [] : (pending || []).map((p) => p.employee_id));

  for (const id of ids) out[id] = active.has(id) ? 'active' : invited.has(id) ? 'invited' : 'none';
  return out;
}

// ── Dueño ────────────────────────────────────────────────────────
async function createInvite(req, res) {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(String(id))) return res.status(404).json({ success: false, error: 'No encontrado' });

    const frontendUrl = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    if (!frontendUrl) {
      logger.error('[EMPLOYEE_INVITE] FRONTEND_URL no está configurada');
      return res.status(500).json({ success: false, error: 'Falta configurar la URL del panel (FRONTEND_URL).' });
    }

    const { data: emp, error: empErr } = await supabaseAdmin
      .from('employees')
      .select('id, name, phone, is_active, user_id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (isMissingSchema(empErr)) return res.status(503).json({ success: false, error: MIGRATION_MISSING });
    if (empErr) throw empErr;
    if (!emp) return res.status(404).json({ success: false, error: 'No encontrado' });
    if (!emp.is_active) return res.status(400).json({ success: false, error: 'Activa al empleado antes de invitarlo al panel.' });
    if (emp.user_id) return res.status(409).json({ success: false, error: 'Este empleado ya tiene acceso al panel.' });

    let token; let expiresAt; let inserted = false;
    for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
      const { error: revErr } = await revokePending(req.businessId, emp.id);
      if (isMissingSchema(revErr)) return res.status(503).json({ success: false, error: MIGRATION_MISSING });
      if (revErr) throw revErr;

      token = crypto.randomBytes(32).toString('base64url');
      expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const { error: insErr } = await supabaseAdmin.from('employee_invites').insert({
        business_id: req.businessId,
        employee_id: emp.id,
        token_hash: hashToken(token),
        expires_at: expiresAt,
        created_by: req.user.id,
      });
      if (!insErr) inserted = true;
      else if (insErr.code !== '23505') throw insErr; // 23505: otra invitación simultánea; se revoca y se reintenta
    }
    if (!inserted) return res.status(409).json({ success: false, error: 'Intenta de nuevo en unos segundos.' });

    const link = `${frontendUrl}/invitacion/${token}`;
    const businessName = req.business?.name || 'tu negocio';
    const message = `Hola ${emp.name}, te invito a tu panel de ${businessName} en ZITA: ${link}`;
    const phone = normalizeColombianPhone(emp.phone);
    const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;

    logger.info('[EMPLOYEE_INVITE_CREATED]', { businessId: req.businessId, employeeId: emp.id });
    noStore(res);
    return res.status(201).json({ success: true, data: { link, message, whatsapp_url: whatsappUrl, expires_at: expiresAt } });
  } catch (err) {
    logger.error(`invitations.createInvite: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function revokeAccess(req, res) {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(String(id))) return res.status(404).json({ success: false, error: 'No encontrado' });
    const { data: emp, error } = await supabaseAdmin
      .from('employees').select('id').eq('id', id).eq('business_id', req.businessId).maybeSingle();
    if (error) throw error;
    if (!emp) return res.status(404).json({ success: false, error: 'No encontrado' });

    const { hadAccount } = await removeEmployeeAccess(req.businessId, emp.id);
    logger.info('[EMPLOYEE_ACCESS_REVOKED]', { businessId: req.businessId, employeeId: emp.id, hadAccount });
    return res.json({ success: true, data: { access_status: 'none' } });
  } catch (err) {
    logger.error(`invitations.revokeAccess: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ── Público ──────────────────────────────────────────────────────
async function getInvitation(req, res) {
  try {
    noStore(res);
    const found = await findValidInvite(req.params.token);
    if (!found) return invalid(res);
    return res.json({ success: true, data: { business_name: found.businessName, employee_name: found.employee.name } });
  } catch (err) {
    logger.error(`invitations.getInvitation: ${err.message}`);
    return invalid(res);
  }
}

function isEmailTaken(error) {
  if (!error) return false;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists/i.test(error.message || '');
}

async function acceptInvitation(req, res) {
  noStore(res);
  const { token } = req.params;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!TOKEN_RE.test(String(token))) return invalid(res);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, error: 'Ingresa un correo válido.' });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ success: false, error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
  }

  let claimedId = null;
  let createdUserId = null;
  try {
    const found = await findValidInvite(token);
    if (!found) return invalid(res);
    const { invite, employee } = found;

    // Reserva atómica: un solo UPDATE condicional. De dos peticiones simultáneas, solo una obtiene la fila.
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('employee_invites')
      .update({ used_at: nowIso })
      .eq('id', invite.id)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .select('id');
    if (claimErr || !claimed || claimed.length !== 1) return invalid(res);
    claimedId = invite.id;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'employee' },
    });

    if (createErr || !created?.user?.id) {
      // Se libera la reserva: el enlace sigue sirviendo con otro correo
      await supabaseAdmin.from('employee_invites').update({ used_at: null }).eq('id', claimedId);
      claimedId = null;
      if (isEmailTaken(createErr)) {
        logger.info('[EMPLOYEE_INVITE_EMAIL_TAKEN]', { businessId: invite.business_id, employeeId: employee.id, email: maskEmail(email) });
        return res.status(409).json({
          success: false,
          code: 'EMAIL_EXISTS',
          error: 'Ese correo ya tiene una cuenta en ZITA. Usa otro correo o pídele al dueño del negocio que te registre con uno diferente.',
        });
      }
      if (createErr?.code === 'weak_password') {
        return res.status(400).json({ success: false, error: 'La contraseña es muy débil. Usa una más larga o con más variedad.' });
      }
      logger.error('[EMPLOYEE_INVITE_CREATE_USER_FAILED]', { error: createErr?.message || 'sin usuario' });
      return res.status(500).json({ success: false, error: 'No se pudo crear la cuenta. Intenta de nuevo.' });
    }

    const userId = created.user.id;
    createdUserId = userId;
    const { data: linked, error: linkErr } = await supabaseAdmin
      .from('employees')
      .update({ user_id: userId })
      .eq('id', employee.id)
      .eq('business_id', invite.business_id)
      .eq('is_active', true)
      .is('user_id', null)
      .select('id');

    if (linkErr || !linked || linked.length !== 1) {
      // Compensación: no dejar una cuenta huérfana. La invitación queda usada.
      createdUserId = null;
      claimedId = null;
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      logger.error('[EMPLOYEE_INVITE_LINK_FAILED]', { businessId: invite.business_id, employeeId: employee.id, error: linkErr?.message });
      return invalid(res);
    }

    createdUserId = null;
    claimedId = null;
    logger.info('[EMPLOYEE_INVITE_ACCEPTED]', { businessId: invite.business_id, employeeId: employee.id, email: maskEmail(email) });
    return res.status(201).json({ success: true, data: { email } });
  } catch (err) {
    // Error inesperado a mitad de camino: deshacer cuenta creada y liberar la reserva
    if (createdUserId) {
      await Promise.resolve(supabaseAdmin.auth.admin.deleteUser(createdUserId)).catch(() => {});
    }
    if (claimedId) {
      await Promise.resolve(supabaseAdmin.from('employee_invites').update({ used_at: null }).eq('id', claimedId)).catch(() => {});
    }
    logger.error(`invitations.acceptInvitation: ${err.message}`);
    return res.status(500).json({ success: false, error: 'No se pudo crear la cuenta. Intenta de nuevo.' });
  }
}

module.exports = {
  createInvite, revokeAccess, getInvitation, acceptInvitation,
  removeEmployeeAccess, accessStatusFor, hashToken, findValidInvite,
};
