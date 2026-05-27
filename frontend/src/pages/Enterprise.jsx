import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, Building2, Plug, Code2 } from 'lucide-react';
import PublicNavbar from '../components/public/PublicNavbar';
import PublicFooter from '../components/public/PublicFooter';

export default function Enterprise() {
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

  const servicios = [
    {
      icon: Wrench,
      title: 'Implementación personalizada',
      desc: 'Adaptamos ZITA exactamente a tu flujo de trabajo. Módulos custom, campos específicos y automatizaciones a medida.',
      features: ['Análisis de necesidades', 'Desarrollo custom', 'Capacitación del equipo', 'Soporte dedicado'],
    },
    {
      icon: Building2,
      title: 'Multi-sede y franquicias',
      desc: 'Gestiona todas tus sedes desde un panel central. Métricas unificadas y control total.',
      features: ['Panel centralizado', 'Reportes por sede', 'Permisos por rol', 'API para integraciones'],
    },
    {
      icon: Plug,
      title: 'Integraciones',
      desc: 'Conectamos ZITA con el software que ya usas — POS, ERP, CRM o cualquier sistema con API.',
      features: ['Siigo', 'World Office', 'Google Calendar', 'Sistemas propietarios'],
    },
    {
      icon: Code2,
      title: 'Desarrollo a medida',
      desc: '¿Necesitas algo que no existe? Lo construimos. Somos expertos en SaaS, automatización e IA.',
      features: ['Aplicaciones web', 'Bots con IA', 'Automatizaciones', 'Consultoría técnica'],
    },
  ];

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

      {/* HERO */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8 relative section-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-block px-4 py-2 rounded-full border border-violet-500/50 bg-violet-500/10 text-sm text-violet-300">
            🏢 Para empresas
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black px-4 break-words overflow-hidden w-full text-center">ZITA para tu empresa</h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Soluciones personalizadas para negocios que necesitan más que un plan estándar.
          </p>
          <Link
            to="/contacto"
            className="inline-block px-8 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition"
          >
            Hablar con el equipo →
          </Link>
        </div>
      </section>

      {/* SERVICIOS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 section-hidden">
        <div className="max-w-6xl mx-auto space-y-12">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center px-4">Nuestros servicios</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {servicios.map((s, i) => {
              const IconComponent = s.icon;
              return (
              <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8 hover:border-violet-400/50 transition">
                <IconComponent size={32} className="text-violet-400 mb-4" />
                <h3 className="text-2xl font-bold mb-3">{s.title}</h3>
                <p className="text-gray-400 mb-6">{s.desc}</p>
                <ul className="space-y-2 text-sm text-gray-300">
                  {s.features.map((f, j) => (
                    <li key={j}>✓ {f}</li>
                  ))}
                </ul>
              </div>
            );
            })}
          </div>
        </div>
      </section>

      {/* PROCESO */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] to-violet-950/20 section-hidden">
        <div className="max-w-6xl mx-auto space-y-12">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center px-4">¿Cómo funciona?</h2>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              'Cuéntanos tu necesidad',
              'Analizamos y cotizamos',
              'Desarrollamos e implementamos',
              'Soporte continuo',
            ].map((step, i) => (
              <div key={i} className="text-center space-y-4">
                <div className="text-4xl font-black text-violet-400">0{i + 1}</div>
                <p className="font-semibold">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRECIOS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 section-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black px-4">Precios según tu proyecto</h2>
          <h3 className="text-2xl font-bold text-violet-400">desde $250.000 COP/mes</h3>
          <p className="text-lg text-gray-400">
            No mostramos precios fijos — cada proyecto es único. Contáctanos para recibir una cotización personalizada.
          </p>
          <Link
            to="/contacto"
            className="inline-block px-8 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition"
          >
            Solicitar cotización gratuita →
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
