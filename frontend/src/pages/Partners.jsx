import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicNavbar from '../components/public/PublicNavbar';
import PublicFooter from '../components/public/PublicFooter';

export default function Partners() {
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

  const beneficios = [
    {
      title: 'Comisión recurrente',
      icon: '💰',
      desc: 'Ganas el 25% cada mes durante los primeros 12 meses de cada cliente referido. Transparencia total en el pago de comisiones.',
      example: '5 clientes Estándar = $148.750/mes (primeros 12 meses)',
    },
    {
      title: 'Capacitación gratuita',
      icon: '🎓',
      desc: 'Te enseñamos todo sobre ZITA para que puedas venderlo con confianza. Material de ventas incluido.',
    },
    {
      title: 'Panel de seguimiento',
      icon: '📊',
      desc: 'Ve en tiempo real cuántos clientes tienes activos, tus comisiones y el historial de pagos.',
    },
    {
      title: 'Soporte completo',
      icon: '🤝',
      desc: 'Te ayudamos a cerrar ventas. Reuniones con clientes, demos personalizadas y soporte técnico.',
    },
  ];

  const pasos = [
    { num: '01', title: 'Regístrate como partner', desc: 'Llena el formulario de contacto indicando que quieres ser partner' },
    { num: '02', title: 'Recibe tu capacitación', desc: 'Te enviamos el material y hacemos una videollamada de 30 minutos' },
    { num: '03', title: 'Consigue clientes', desc: 'Presenta ZITA a negocios de tu ciudad. Nosotros te ayudamos a cerrar' },
    { num: '04', title: 'Cobra tu comisión', desc: 'Cada mes recibes tu pago por cada cliente activo que hayas traído' },
  ];

  const perfiles = ['Freelancers digitales', 'Agencias de marketing', 'Consultores de negocio', 'Personas con red de contactos', 'Estudiantes emprendedores', 'Cualquier persona con ganas de vender'];

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

      {/* HERO */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8 relative bg-gradient-to-b from-violet-950/30 via-[#0a0a0f] to-[#0a0a0f] section-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-block px-4 py-2 rounded-full border border-violet-500/50 bg-violet-500/10 text-sm text-violet-300">
            🤝 Programa de Partners
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black px-4 break-words overflow-hidden w-full text-center">Gana dinero vendiendo ZITA</h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Conviértete en partner y recibe comisión recurrente por cada cliente que traigas. Sin inversión, sin riesgo.
          </p>
          <Link
            to="/partners/registro"
            className="inline-block px-8 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition"
          >
            Quiero ser partner →
          </Link>
        </div>
      </section>

      {/* STATS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5 section-hidden">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-5xl font-black text-violet-400 mb-2">30%</div>
            <p className="text-gray-400">Comisión mensual recurrente</p>
          </div>
          <div>
            <div className="text-5xl font-black text-green-400 mb-2">$30.000</div>
            <p className="text-gray-400">Por cada cliente Estándar activo/mes</p>
          </div>
          <div>
            <div className="text-5xl font-black text-violet-400 mb-2">∞</div>
            <p className="text-gray-400">Sin límite de clientes</p>
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5 section-hidden">
        <div className="max-w-6xl mx-auto space-y-12">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center px-4">Beneficios para ti</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {beneficios.map((b, i) => (
              <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8 hover:border-violet-400/50 transition">
                <div className="text-5xl mb-4">{b.icon}</div>
                <h3 className="text-2xl font-bold mb-3">{b.title}</h3>
                <p className="text-gray-400 mb-4">{b.desc}</p>
                {b.example && <p className="text-sm text-violet-400">💡 {b.example}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] to-violet-950/20 section-hidden">
        <div className="max-w-6xl mx-auto space-y-12">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center px-4">¿Cómo funciona?</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {pasos.map((p, i) => (
              <div key={i} className="space-y-3">
                <div className="text-4xl font-black text-violet-400">{p.num}</div>
                <h3 className="font-bold text-lg">{p.title}</h3>
                <p className="text-sm text-gray-400">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TABLA COMISIONES */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5 section-hidden">
        <div className="max-w-3xl mx-auto space-y-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center px-4">¿Cuánto puedes ganar?</h2>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto bg-[#1e293b] border border-white/10 rounded-xl py-6 px-8">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-4 font-bold">Plan</th>
                  <th className="text-left py-3 px-4 font-bold">Valor cliente</th>
                  <th className="text-left py-3 px-4 font-bold">Tu comisión (25%, primeros 12 meses)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-700 hover:bg-slate-900/50">
                  <td className="py-3 px-4">Plan Lite</td>
                  <td className="py-3 px-4">$69.000/mes</td>
                  <td className="py-3 px-4 text-violet-400 font-semibold">$17.250/mes</td>
                </tr>
                <tr className="border-b border-slate-700 hover:bg-slate-900/50">
                  <td className="py-3 px-4">Plan Estándar</td>
                  <td className="py-3 px-4">$119.000/mes</td>
                  <td className="py-3 px-4 text-violet-400 font-semibold">$29.750/mes</td>
                </tr>
                <tr className="hover:bg-slate-900/50">
                  <td className="py-3 px-4">Plan Pro</td>
                  <td className="py-3 px-4">$199.000/mes</td>
                  <td className="py-3 px-4 text-violet-400 font-semibold">$49.750/mes</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {[
              { plan: 'Plan Lite', valor: '$69.000/mes', comision: '$17.250/mes (12 meses)' },
              { plan: 'Plan Estándar', valor: '$119.000/mes', comision: '$29.750/mes (12 meses)' },
              { plan: 'Plan Pro', valor: '$199.000/mes', comision: '$49.750/mes (12 meses)' },
            ].map((row, i) => (
              <div key={i} className="bg-[#1e293b] border border-white/10 rounded-xl p-4 space-y-2">
                <div className="font-bold text-white">{row.plan}</div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Valor:</span>
                  <span className="text-white">{row.valor}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Comisión:</span>
                  <span className="text-violet-400 font-semibold">{row.comision}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-blue-950/30 border border-blue-500/50 rounded-lg p-4 text-center">
            <p className="text-sm text-blue-300">
              ℹ️ <span className="font-semibold">Comisión limitada a 12 meses:</span> Ganas comisión durante los primeros 12 meses después de que cada cliente se activa. Esto nos permite mantener márgenes saludables y seguir invirtiendo en el producto.
            </p>
          </div>
          <div className="bg-[#4c1d95] border border-violet-500 rounded-lg p-6 text-center">
            <p className="text-lg font-semibold">
              Con solo 10 clientes en Plan Estándar = <span className="text-xl font-bold text-violet-300">$297.500/mes</span> (primeros 12 meses) 💰
            </p>
          </div>
        </div>
      </section>

      {/* PERFIL IDEAL */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5 section-hidden">
        <div className="max-w-3xl mx-auto space-y-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center px-4">¿Para quién es esto?</h2>
          <div className="flex flex-wrap gap-4 justify-center">
            {perfiles.map((p, i) => (
              <div
                key={i}
                className="px-6 py-3 bg-violet-900/20 border border-violet-500/30 rounded-full text-sm font-medium hover:border-violet-400/50 hover:bg-violet-900/40 transition"
              >
                {p}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] to-violet-950/30 section-hidden">
        <div className="max-w-3xl mx-auto bg-gradient-to-r from-violet-600/20 to-violet-500/20 border border-violet-500/30 rounded-3xl p-12 text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black px-4">¿Listo para empezar a ganar?</h2>
          <p className="text-xl text-gray-300">Sin inversión · Sin riesgo · 100% comisión</p>
          <Link
            to="/partners/registro"
            className="inline-block px-8 py-4 bg-white text-black rounded-lg font-bold hover:bg-gray-100 transition"
          >
            Registrarme como partner →
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
