import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

const inputCls = 'w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition';

// Aceptar la invitación al panel de empleado: /invitacion/:token (pública).
// Abrir la página NO consume el enlace; solo se usa al crear la cuenta.
export default function Invitation() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login, user, logout } = useAuth();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/api/invitations/${encodeURIComponent(token || '')}`)
      .then((r) => { if (alive) setInfo(r.data.data); })
      .catch((err) => { if (alive) setLoadError(err.response?.data?.error || 'No se pudo abrir la invitación. Revisa tu conexión.'); });
    return () => { alive = false; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const email = form.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Ingresa un correo válido.');
    if (form.password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (form.password !== form.confirm) return setError('Las contraseñas no coinciden.');

    setSubmitting(true);
    try {
      await api.post(`/api/invitations/${encodeURIComponent(token)}/accept`, { email, password: form.password });
      // Si había otra sesión abierta en este navegador, se cierra antes de entrar con la cuenta nueva
      if (user) await logout();
      await login(email, form.password);
      navigate('/mi-panel', { replace: true });
    } catch (err) {
      if (err.response?.status === 429) setError('Demasiados intentos. Espera unos minutos e intenta de nuevo.');
      else if (err.response?.data?.code === 'INVITE_INVALID') { setInfo(null); setLoadError(err.response.data.error); }
      else if (err.response) setError(err.response.data?.error || 'No se pudo crear la cuenta.');
      else setError('Tu cuenta quedó creada, pero no pudimos iniciar sesión. Entra desde "Iniciar sesión".');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080d18] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <img src="/logo.png" alt="ZITA" className="h-8 w-8 object-contain" />
          <span className="text-white font-bold text-2xl tracking-tight">ZITA</span>
        </div>

        <div className="bg-[#131929] border border-violet-500/20 rounded-2xl p-6 shadow-2xl">
          {!info && !loadError && (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {loadError && (
            <div className="text-center py-4">
              <h1 className="text-white font-semibold text-lg mb-2">Invitación no disponible</h1>
              <p className="text-slate-400 text-sm mb-5">{loadError}</p>
              <Link to="/login" className="text-violet-400 hover:text-violet-300 text-sm">¿Ya tienes cuenta? Inicia sesión</Link>
            </div>
          )}

          {info && (
            <>
              <h1 className="text-white font-semibold text-lg">Hola {info.employee_name} 👋</h1>
              <p className="text-slate-400 text-sm mt-1 mb-5">
                <span className="text-white">{info.business_name}</span> te invitó a tu panel en ZITA. Crea tu acceso con tu correo y una contraseña.
              </p>
              <form onSubmit={submit} className="space-y-3" noValidate>
                {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}
                <div>
                  <label className="block text-slate-300 text-sm mb-1.5" htmlFor="inv-email">Correo</label>
                  <input id="inv-email" type="email" autoComplete="email" value={form.email} maxLength={254}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="tucorreo@ejemplo.com" />
                </div>
                <div>
                  <label className="block text-slate-300 text-sm mb-1.5" htmlFor="inv-pass">Contraseña</label>
                  <div className="relative">
                    <input id="inv-pass" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} maxLength={72}
                      onChange={(e) => setForm({ ...form, password: e.target.value })} className={`${inputCls} pr-10`} placeholder="Mínimo 8 caracteres" />
                    <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-slate-300 text-sm mb-1.5" htmlFor="inv-confirm">Repite la contraseña</label>
                  <input id="inv-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirm} maxLength={72}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })} className={inputCls} />
                </div>
                <button type="submit" disabled={submitting}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition mt-2">
                  {submitting ? 'Creando tu acceso...' : 'Crear mi acceso'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
