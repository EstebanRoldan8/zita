import { useState, useEffect } from 'react';
import PublicNavbar from '../components/public/PublicNavbar';
import PublicFooter from '../components/public/PublicFooter';

export default function RegistroPartner() {
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
    ciudad: '',
    whatsapp: '',
    email: '',
    dedicacion: '',
    negocios_conoce: '',
    ciudades_contactos: '',
    razon_partner: '',
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
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          servicio: 'partner_registro',
          tipo_negocio: 'partner',
        }),
      });

      if (res.ok) {
        setMessage({
          type: 'success',
          text: '✅ ¡Listo! Recibimos tu solicitud. Te contactamos por WhatsApp en menos de 24h para darte todos los detalles. 🤝',
        });
        setForm({
          nombre: '',
          ciudad: '',
          whatsapp: '',
          email: '',
          dedicacion: '',
          negocios_conoce: '',
          ciudades_contactos: '',
          razon_partner: '',
        });
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
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black px-4 break-words overflow-hidden w-full text-center">Únete al programa de partners</h1>
          <p className="text-lg text-gray-400">
            Completa el formulario y te contactamos en menos de 24 horas para empezar.
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
              <label className="block text-sm font-semibold mb-2">¿A qué te dedicas?</label>
              <select
                name="dedicacion"
                value={form.dedicacion}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-violet-500"
              >
                <option value="">Selecciona una opción</option>
                <option value="freelancer_digital">Freelancer digital</option>
                <option value="agencia_marketing">Agencia de marketing</option>
                <option value="consultor_negocios">Consultor de negocios</option>
                <option value="estudiante">Estudiante</option>
                <option value="vendedor_independiente">Vendedor independiente</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">¿Cuántos negocios conoces que podrían usar ZITA?</label>
              <select
                name="negocios_conoce"
                value={form.negocios_conoce}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-violet-500"
              >
                <option value="">Selecciona una opción</option>
                <option value="1-5">1-5</option>
                <option value="5-10">5-10</option>
                <option value="10-20">10-20</option>
                <option value="mas_20">Más de 20</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">¿En qué ciudad(es) tienes contactos?</label>
              <input
                type="text"
                name="ciudades_contactos"
                value={form.ciudades_contactos}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500"
                placeholder="Cali, Bogotá, Medellín..."
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">¿Por qué quieres ser partner? *</label>
              <textarea
                name="razon_partner"
                value={form.razon_partner}
                onChange={handleChange}
                required
                rows="5"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-none"
                placeholder="Cuéntanos tu motivación..."
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

      <PublicFooter />
    </div>
  );
}
