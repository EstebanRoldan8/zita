import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicNavbar from '../components/public/PublicNavbar';
import PublicFooter from '../components/public/PublicFooter';

export default function Contacto() {
  const [scroll, setScroll] = useState(0);
  const [pos, setPos] = useState({x: -500, y: -500});

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setScroll(total > 0 ? (window.scrollY / total) * 100 : 0);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const move = (e) => setPos({x: e.clientX, y: e.clientY});
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('section-visible');
        }
      }),
      { threshold: 0.1 }
    );
    document.querySelectorAll('.section-hidden').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const particleCount = isMobile ? 8 : 20;
  const particles = Array.from({length: particleCount}, (_, i) => ({
    id: i,
    size: isMobile ? Math.random() * 2 : Math.random() * 3 + 2,
    left: Math.random() * 100,
    top: Math.random() * 100,
    duration: isMobile ? Math.random() * 6 + 4 : Math.random() * 4 + 2,
    delay: Math.random() * 4,
    color: i % 3 === 0 ? '#7c3aed' : '#ffffff',
    opacity: isMobile ? 0.15 : 0.3
  }));

  const [form, setForm] = useState({
    nombre: '',
    tipo_negocio: '',
    ciudad: '',
    whatsapp: '',
    email: '',
    plan_interes: 'no_seguro',
    mensaje: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const PLAN_LABELS_MAP = {
        lite: 'Plan Lite',
        estandar: 'Plan Estándar',
        pro: 'Plan Pro',
        enterprise: 'Enterprise / Multi-sede',
        demo: 'Demo',
        partners: 'Programa de Partners',
        no_seguro: 'Aún no está seguro',
      };

      let servicioCategoria = 'general';
      if (form.plan_interes === 'enterprise') servicioCategoria = 'enterprise';
      else if (form.plan_interes === 'demo') servicioCategoria = 'demo';
      else if (form.plan_interes === 'partners') servicioCategoria = 'partners';

      const mensajeConPlan = `[Interés: ${PLAN_LABELS_MAP[form.plan_interes] || 'No especificado'}]\n\n${form.mensaje}`;

      const payload = {
        nombre: form.nombre,
        tipo_negocio: form.tipo_negocio,
        ciudad: form.ciudad,
        whatsapp: form.whatsapp,
        email: form.email,
        servicio: servicioCategoria,
        mensaje: mensajeConPlan,
      };

      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: '✅ Recibimos tu solicitud. Te contactamos pronto por WhatsApp.' });
        setForm({ nombre: '', tipo_negocio: '', ciudad: '', whatsapp: '', email: '', plan_interes: 'no_seguro', mensaje: '' });
      } else {
        setMessage({ type: 'error', text: 'Error al enviar la solicitud. Intenta de nuevo.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden" style={{position: 'relative', overflow: 'hidden'}}>
      <PublicNavbar />

      <div style={{
        position: 'fixed', top: 0, left: 0,
        height: '3px',
        width: `${scroll}%`,
        background: 'linear-gradient(to right, #7c3aed, #a78bfa)',
        zIndex: 9999,
        transition: 'width 0.1s ease'
      }} />

      <div style={{
        position: 'fixed',
        left: pos.x - 150, top: pos.y - 150,
        width: 300, height: 300,
        background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 1,
        transition: 'left 0.3s ease, top 0.3s ease'
      }} />

      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-violet-900/20 rounded-full blur-3xl"></div>
      </div>

      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          left: `${p.left}%`,
          top: `${p.top}%`,
          width: p.size,
          height: p.size,
          borderRadius: '50%',
          background: p.color,
          opacity: p.opacity,
          animation: `float ${p.duration}s ease-in-out ${p.delay}s infinite`,
          pointerEvents: 'none'
        }} />
      ))}

      {/* HERO PEQUEÑO */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8 relative section-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black px-4 break-words overflow-hidden w-full text-center">Hablemos de tu negocio</h1>
          <p className="text-lg text-gray-400">
            Cuéntanos qué necesitas y te contactamos en menos de 24 horas.
          </p>
        </div>
      </section>

      {/* FORMULARIO */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 relative section-hidden">
        <div className="max-w-2xl mx-auto">
          {message && (
            <div
              className={`mb-6 p-4 rounded-lg border ${
                message.type === 'success'
                  ? 'bg-green-500/10 border-green-500/30 text-green-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-2">Nombre completo *</label>
              <input
                type="text"
                name="nombre"
                value={form.nombre}
                onChange={handleChange}
                required
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500"
                placeholder="Tu nombre"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Tipo de negocio</label>
              <select
                name="tipo_negocio"
                value={form.tipo_negocio}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-violet-500"
              >
                <option value="">Selecciona una opción</option>
                <option value="barberia">Barbería</option>
                <option value="spa">Spa</option>
                <option value="veterinaria">Veterinaria</option>
                <option value="dentista">Dentista</option>
                <option value="tienda">Tienda</option>
                <option value="gimnasio">Gimnasio</option>
                <option value="empresa">Empresa grande</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Ciudad *</label>
              <input
                type="text"
                name="ciudad"
                value={form.ciudad}
                onChange={handleChange}
                required
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500"
                placeholder="Tu ciudad"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">WhatsApp *</label>
              <input
                type="tel"
                name="whatsapp"
                value={form.whatsapp}
                onChange={handleChange}
                required
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500"
                placeholder="+57 31234567"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Email (opcional)</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500"
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Plan de interés</label>
              <select
                name="plan_interes"
                value={form.plan_interes}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-violet-500"
              >
                <option value="lite">Plan Lite</option>
                <option value="estandar">Plan Estándar</option>
                <option value="pro">Plan Pro</option>
                <option value="enterprise">Enterprise / Multi-sede</option>
                <option value="demo">Quiero una demo</option>
                <option value="partners">Programa de Partners</option>
                <option value="no_seguro">Aún no estoy seguro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Mensaje *</label>
              <textarea
                name="mensaje"
                value={form.mensaje}
                onChange={handleChange}
                required
                rows="5"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-none"
                placeholder="Cuéntanos qué necesitas..."
              ></textarea>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 disabled:opacity-50 text-white font-semibold rounded-lg transition"
            >
              {loading ? 'Enviando...' : 'Enviar solicitud →'}
            </button>
          </form>
        </div>
      </section>

      {/* ENTERPRISE SECTION */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] to-violet-950/20 section-hidden">
        <div className="max-w-6xl mx-auto text-center space-y-8">
          <h2 className="text-3xl md:text-4xl font-black">¿Tienes una empresa grande?</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6 hover:border-violet-400/50 transition">
              <div className="text-3xl mb-3">🔧</div>
              <h3 className="font-bold mb-2">Implementación personalizada</h3>
            </div>
            <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6 hover:border-violet-400/50 transition">
              <div className="text-3xl mb-3">🏢</div>
              <h3 className="font-bold mb-2">Multi-sede y franquicias</h3>
            </div>
            <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6 hover:border-violet-400/50 transition">
              <div className="text-3xl mb-3">💻</div>
              <h3 className="font-bold mb-2">Desarrollo a medida</h3>
            </div>
          </div>
          <Link
            to="/enterprise"
            className="inline-block px-8 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition"
          >
            Ver más sobre Enterprise →
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
