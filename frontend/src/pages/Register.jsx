import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import api from '../lib/api';

const BUSINESS_TYPES = [
  { value: 'barberia', label: 'Barbería' },
  { value: 'spa', label: 'Spa' },
  { value: 'veterinaria', label: 'Veterinaria' },
  { value: 'dentista', label: 'Dentista' },
  { value: 'tienda', label: 'Tienda' },
  { value: 'gimnasio', label: 'Gimnasio' },
  { value: 'otro', label: 'Otro' },
];

const COUNTRIES = [
  { value: 'colombia', label: 'Colombia' },
  { value: 'mexico', label: 'México' },
  { value: 'argentina', label: 'Argentina' },
  { value: 'chile', label: 'Chile' },
  { value: 'peru', label: 'Perú' },
  { value: 'ecuador', label: 'Ecuador' },
  { value: 'venezuela', label: 'Venezuela' },
  { value: 'panama', label: 'Panamá' },
  { value: 'costa_rica', label: 'Costa Rica' },
  { value: 'otro', label: 'Otro' },
];

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    ownerName: '',
    name: '',
    business_type: 'barberia',
    ciudad: '',
    country: 'colombia',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successEmail, setSuccessEmail] = useState('');

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const particleCount = isMobile ? 8 : 20;

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const getPasswordStrength = (pwd) => {
    if (pwd.length < 6) return 'red';
    if (pwd.length < 8) return 'yellow';
    return 'green';
  };

  const passwordStrength = form.password.length > 0 ? getPasswordStrength(form.password) : null;
  const passwordsMatch = form.password === form.confirmPassword && form.password.length > 0;
  const isFormValid = form.ownerName && form.name && form.business_type && form.ciudad && form.country && form.phone && form.email && form.password && form.confirmPassword && passwordsMatch && form.password.length >= 8;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 8) {
      return setError('La contraseña debe tener al menos 8 caracteres.');
    }
    if (form.password !== form.confirmPassword) {
      return setError('Las contraseñas no coinciden.');
    }

    setLoading(true);
    try {
      await api.post('/api/auth/register', {
        ownerName: form.ownerName,
        name: form.name,
        email: form.email,
        password: form.password,
        business_type: form.business_type,
        ciudad: form.ciudad,
        country: form.country,
        phone: form.phone,
      });
      setSuccessEmail(form.email);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear la cuenta.');
    } finally {
      setLoading(false);
    }
  };

  if (successEmail) {
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

          {/* Radial glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div className="relative z-10 text-center">
            <h1 className="text-5xl font-bold text-white leading-tight mb-12">
              Atiende a tus<br />
              <span className="text-violet-400">clientes.</span><br />
              ZITA se encarga<br />
              <span className="text-violet-400">del resto.</span>
            </h1>

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

            <div className="inline-block px-4 py-2 bg-violet-500/10 border border-violet-500/30 rounded-full">
              <p className="text-white text-sm">⚡ 14 días gratis · Sin tarjeta de crédito</p>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - Success Screen */}
        <div className="w-full md:w-[45%] bg-[#050508] flex items-center justify-center px-6 md:px-8 lg:px-12 py-8">
          <div className="w-full max-w-md">
            {/* Back link */}
            {!window.matchMedia('(display-mode: standalone)').matches && (
              <Link to="/" className="inline-flex items-center text-violet-400 hover:text-violet-300 transition text-sm mb-8">
                ← Volver
              </Link>
            )}

            <div className="text-center">
            <div className="text-6xl mb-6">✉️</div>
            <h2 className="text-2xl font-bold text-white mb-3">¡Revisa tu email!</h2>
            <p className="text-slate-400 mb-6">Te enviamos un enlace de confirmación a <span className="text-white font-semibold">{successEmail}</span></p>
            <p className="text-slate-400 mb-8">Una vez confirmado podrás iniciar sesión</p>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl px-4 py-3 transition"
            >
              Ir a iniciar sesión →
            </button>
            </div>
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

  return (
    <div className="min-h-screen flex">
      {/* LEFT COLUMN */}
      <div className="hidden md:flex md:w-[55%] bg-gradient-to-b from-[#1a0533] via-[#0a0a0f] to-[#0d1b2e] flex-col items-center justify-center p-8 relative overflow-hidden">
        {/* Floating particles */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          {[...Array(20)].map((_, i) => {
            const randomDuration = Math.random() * 4 + 2;
            const randomDelay = Math.random() * 4;
            const randomSize = Math.random() * 2 + 3;
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
                  opacity: 0.3,
                  animation: `float ${randomDuration}s ease-in-out infinite`,
                  animationDelay: `${randomDelay}s`,
                }}
              />
            );
          })}
        </div>

        {/* Radial glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 text-center">
          <h1 className="text-5xl font-bold text-white leading-tight mb-12">
            Atiende a tus<br />
            <span className="text-violet-400">clientes.</span><br />
            ZITA se encarga<br />
            <span className="text-violet-400">del resto.</span>
          </h1>

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

          <div className="inline-block px-4 py-2 bg-violet-500/10 border border-violet-500/30 rounded-full">
            <p className="text-white text-sm">⚡ 14 días gratis · Sin tarjeta de crédito</p>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="w-full md:w-[45%] bg-[#050508] flex items-center justify-center px-6 md:px-8 lg:px-12 py-8 overflow-y-auto">
        <div className="w-full max-w-md">
          {/* Back link */}
          {!window.matchMedia('(display-mode: standalone)').matches && (
            <Link to="/" className="inline-flex items-center text-violet-400 hover:text-violet-300 transition text-sm mb-8">
              ← Volver
            </Link>
          )}

          {/* Header */}
          <div className="mb-8 text-center">
            <div className="flex justify-center mb-4">
              <img src="/logo.png" alt="ZITA" className="h-14 w-14 object-contain" />
            </div>
            <p className="text-white text-3xl font-semibold mb-4">ZITA</p>
            <h2 className="text-2xl font-bold text-white mb-2">Crea tu cuenta gratis</h2>
            <div className="flex items-center justify-center gap-2">
              <p className="text-slate-400">14 días gratis · Sin tarjeta de crédito</p>
              <span className="inline-block px-2 py-1 bg-green-500/20 border border-green-500/30 rounded text-xs text-green-400">✓</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-6">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Row 1: Owner Name and Business Name (2-column grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
              {/* Owner Name */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Tu nombre *</label>
                <input
                  type="text"
                  name="ownerName"
                  value={form.ownerName}
                  onChange={handleChange}
                  required
                  placeholder="Ej: Juan Pérez"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              {/* Business Name */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Nombre del negocio *</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  placeholder="Barbería Don Juan"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                />
              </div>
            </div>

            {/* Row 2: Business Type (1-column) */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Tipo de negocio *</label>
              <select
                name="business_type"
                value={form.business_type}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition"
              >
                {BUSINESS_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Row 3: Ciudad and País (2-column grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
              {/* City */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Ciudad *</label>
                <input
                  type="text"
                  name="ciudad"
                  value={form.ciudad}
                  onChange={handleChange}
                  required
                  placeholder="Cali"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              {/* Country */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">País *</label>
                <select
                  name="country"
                  value={form.country}
                  onChange={handleChange}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 4: WhatsApp and Email (2-column grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
              {/* WhatsApp */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">WhatsApp *</label>
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  required
                  placeholder="+57 300 123 4567"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Email *</label>
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
            </div>

            {/* Row 4: Password and Confirm Password (2-column grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
              {/* Password */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Contraseña *</label>
                <div className="relative mb-2">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    required
                    placeholder="Mínimo 8 caracteres"
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
                {/* Password strength indicator */}
                {passwordStrength && (
                  <>
                    <div className="flex gap-1 mt-1">
                      <div className={`h-1.5 flex-1 rounded-full ${passwordStrength === 'red' ? 'bg-red-500' : 'bg-slate-700'}`}></div>
                      <div className={`h-1.5 flex-1 rounded-full ${passwordStrength === 'yellow' ? 'bg-yellow-500' : passwordStrength === 'green' ? 'bg-green-500' : 'bg-slate-700'}`}></div>
                      <div className={`h-1.5 flex-1 rounded-full ${passwordStrength === 'green' ? 'bg-green-500' : 'bg-slate-700'}`}></div>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      {passwordStrength === 'red' ? 'Débil' : passwordStrength === 'yellow' ? 'Regular' : 'Fuerte'}
                    </p>
                  </>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm text-slate-300 mb-2">Confirmar contraseña *</label>
                <div className="relative mb-2">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    required
                    placeholder="Repite tu contraseña"
                    className={`w-full bg-slate-900 border rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none transition pr-10 text-white ${form.confirmPassword && !passwordsMatch ? 'border-red-500 focus:border-red-500' : 'border-slate-700 focus:border-violet-500'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {form.confirmPassword && !passwordsMatch && (
                  <p className="text-red-400 text-xs mt-2">Las contraseñas no coinciden</p>
                )}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !isFormValid}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 transition flex items-center justify-center gap-2 mt-8"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creando cuenta...
                </>
              ) : (
                <>Crear cuenta gratis →</>
              )}
            </button>
          </form>

          {/* Legal */}
          <p className="text-slate-400 text-xs text-center mt-6">
            Al registrarte aceptas nuestros{' '}
            <Link to="/terminos" className="text-violet-400 hover:text-violet-300 transition">
              Términos de servicio
            </Link>
            {' '}y{' '}
            <Link to="/privacidad" className="text-violet-400 hover:text-violet-300 transition">
              Política de privacidad
            </Link>
          </p>
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
