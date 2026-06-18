import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function Login() {
  const { login, isSuperadmin } = useAuth();
  const navigate = useNavigate();
  const timeoutRef = useRef(null);
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    const detectRecovery = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (window.location.hash.includes('type=recovery')) {
        setRecoveryMode(true);
      }
    };
    detectRecovery();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const particleCount = isMobile ? 8 : 20;

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate(isSuperadmin ? '/admin' : '/dashboard');
    } catch (err) {
      setError('Email o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResetMessage('');
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/login`,
      });

      if (!resetError) {
        setResetMessage('Te enviamos un enlace a tu correo');
        timeoutRef.current = setTimeout(() => {
          setResetMode(false);
          setResetEmail('');
          setResetMessage('');
        }, 3000);
      } else {
        setError(resetError.message || 'No encontramos una cuenta con ese email.');
      }
    } catch (err) {
      setError('Error al procesar la solicitud.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      setLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

      if (!updateError) {
        setResetMessage('¡Contraseña actualizada! Ya puedes ingresar.');
        timeoutRef.current = setTimeout(() => {
          navigate('/login');
        }, 2000);
      } else {
        setError(updateError.message || 'Error al actualizar la contraseña.');
      }
    } catch (err) {
      setError('Error al procesar la solicitud.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* LEFT COLUMN - Hidden on mobile */}
      <div className="hidden md:flex md:w-[55%] bg-gradient-to-b from-[#1a0533] via-[#0a0a0f] to-[#0d1b2e] flex-col items-center justify-center p-8 relative overflow-hidden">
        {/* Floating particles */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          {[...Array(particleCount)].map((_, i) => {
            const randomDuration = isMobile ? Math.random() * 6 + 4 : Math.random() * 4 + 2;
            const randomDelay = Math.random() * 4;
            const randomSize = isMobile ? Math.random() * 2 : Math.random() * 2 + 3;
            const randomLeft = Math.random() * 100;
            const randomTop = Math.random() * 100;
            const isViolet = i % 2 === 0;

            return (
              <div
                key={i}
                className={`absolute rounded-full ${isViolet ? 'bg-violet-500' : 'bg-white'}`}
                style={{
                  width: `${randomSize}px`,
                  height: `${randomSize}px`,
                  left: `${randomLeft}%`,
                  top: `${randomTop}%`,
                  opacity: isMobile ? 0.15 : 0.3,
                  animation: `float ${randomDuration}s ease-in-out infinite`,
                  animationDelay: `${randomDelay}s`,
                }}
              />
            );
          })}
        </div>

        {/* Radial glow top right */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Main heading and content - centered */}
        <div className="relative z-10 text-center">
          <h1 className="text-5xl font-bold text-white leading-tight mb-12">
            Atiende a tus<br />
            <span className="text-violet-400">clientes.</span><br />
            ZITA se encarga<br />
            <span className="text-violet-400">del resto.</span>
          </h1>

          {/* Features */}
          <div className="space-y-4 mb-12">
            <div className="flex items-center gap-3 text-white">
              <span className="text-green-400 font-bold text-xl">✓</span>
              <p className="text-base">Bot WhatsApp que agenda solo, 24/7</p>
            </div>
            <div className="flex items-center gap-3 text-white">
              <span className="text-green-400 font-bold text-xl">✓</span>
              <p className="text-base">Panel completo para gestionar tu negocio</p>
            </div>
            <div className="flex items-center gap-3 text-white">
              <span className="text-green-400 font-bold text-xl">✓</span>
              <p className="text-base">Asistente IA que entiende español colombiano</p>
            </div>
          </div>

          {/* Bottom badge */}
          <div className="inline-block px-4 py-2 bg-violet-500/10 border border-violet-500/30 rounded-full">
            <p className="text-white text-sm">⚡ 14 días gratis · Sin tarjeta de crédito</p>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="w-full md:w-[45%] bg-[#050508] flex items-center justify-center px-6 md:px-8 lg:px-12 py-8">
        <div className="w-full max-w-md">
          {/* Back link */}
          {!window.matchMedia('(display-mode: standalone)').matches && (
            <Link to="/" className="inline-flex items-center text-violet-400 hover:text-violet-300 transition text-sm mb-8">
              ← Volver
            </Link>
          )}

          {/* Logo and ZITA text */}
          <div className="flex flex-col items-center mb-6">
            <img src="/logo.png" className="h-14 w-14 object-contain" />
            <span className="text-white font-black text-3xl tracking-tight mt-2">
              ZITA
            </span>
          </div>

          {/* Content */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">
              {recoveryMode ? 'Nueva contraseña' : 'Bienvenido de vuelta'}
            </h2>
            <p className="text-slate-400">
              {recoveryMode ? 'Crea una nueva contraseña segura' : 'Ingresa a tu panel de ZITA'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-6">
              {error}
            </div>
          )}

          {/* Recovery Password Form */}
          {recoveryMode && (
            <form onSubmit={handleRecoverySubmit} className="space-y-5 mb-6">
              {/* New Password */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Nueva contraseña</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="Mínimo 8 caracteres"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
                  >
                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Confirmar contraseña</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="Repite tu contraseña"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {resetMessage && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3">
                  {resetMessage}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 transition flex items-center justify-center gap-2 mt-8"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Guardando...
                  </>
                ) : (
                  <>Guardar contraseña →</>
                )}
              </button>
            </form>
          )}

          {/* Reset Password Section */}
          {resetMode && (
            <form onSubmit={handleResetSubmit} className="space-y-5 mb-6 bg-slate-900/30 border border-violet-500/30 p-6 rounded-xl">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Email para recuperación</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  placeholder="tu@negocio.com"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                />
              </div>
              {resetMessage && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3">
                  {resetMessage}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-3 transition"
                >
                  {loading ? 'Enviando...' : 'Enviar enlace'}
                </button>
                {!window.matchMedia('(display-mode: standalone)').matches && (
                  <button
                    type="button"
                    onClick={() => setResetMode(false)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl px-4 py-3 transition"
                  >
                    Volver
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Form */}
          {!resetMode && !recoveryMode && (
          <form onSubmit={handleSubmit} className="space-y-5 mb-6">
            {/* Email */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                required
                placeholder="tu@negocio.com"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            {/* Password with eye icon */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm text-slate-300">Contraseña</label>
                <button
                  type="button"
                  onClick={() => setResetMode(!resetMode)}
                  className="text-xs text-violet-400 hover:text-violet-300 transition"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 transition flex items-center justify-center gap-2 mt-8"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Ingresando...
                </>
              ) : (
                <>Ingresar →</>
              )}
            </button>
          </form>
          )}

          {/* Bottom text */}
          {!resetMode && !recoveryMode && (
            <p className="text-slate-400 text-sm text-center">
              ¿No tienes cuenta?{' '}
              <Link to="/register" className="text-violet-400 hover:text-violet-300 transition font-semibold">
                Regístrate gratis →
              </Link>
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
      `}</style>
    </div>
  );
}
