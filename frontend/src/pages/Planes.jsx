import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import PublicNavbar from '../components/public/PublicNavbar';
import PublicFooter from '../components/public/PublicFooter';

const PLAN_DESCRIPTIONS = {
  lite: 'Para negocios que están comenzando',
  estandar: 'El más popular entre nuestros clientes',
  pro: 'Para negocios que quieren crecer sin límites',
};

const PLAN_FEATURES = {
  lite: ['bot_whatsapp', 'citas', 'empleados', 'caja', 'configuracion'],
  estandar: ['bot_whatsapp', 'citas', 'empleados', 'caja', 'clientes', 'productos', 'analiticas', 'configuracion', 'asistente_ia'],
  pro: ['bot_whatsapp', 'citas', 'empleados', 'caja', 'clientes', 'productos', 'analiticas', 'configuracion', 'asistente_ia', 'campanas', 'reportes_pdf', 'multi_sede', 'pedidos'],
};

const FEATURE_LABELS = {
  'bot_whatsapp': 'Bot WhatsApp',
  'citas': 'Citas',
  'empleados': 'Empleados',
  'caja': 'Caja',
  'clientes': 'Clientes',
  'productos': 'Productos',
  'analiticas': 'Analíticas',
  'configuracion': 'Configuración',
  'asistente_ia': 'Asistente IA',
  'campanas': 'Campañas',
  'reportes_pdf': 'Reportes PDF',
  'multi_sede': 'Multi-sede',
  'pedidos': 'Pedidos',
};

const PLANS = [
  {
    key: 'lite',
    name: 'Lite',
    price: 60000,
    bg: 'bg-gradient-to-b from-slate-800/40 to-gray-900/40',
    border: 'border-slate-600/50',
    nameColor: 'text-slate-300',
    shadowClass: 'shadow-lg shadow-gray-900/50',
  },
  {
    key: 'estandar',
    name: 'Estándar',
    price: 100000,
    bg: 'bg-gradient-to-b from-violet-950/60 to-gray-900/60',
    border: 'border-violet-500 border-2',
    nameColor: 'text-violet-400',
    shadowClass: 'shadow-xl shadow-violet-500/25',
    featured: true,
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 150000,
    bg: 'bg-gradient-to-b from-yellow-950/40 to-gray-900/60',
    border: 'border-yellow-400/40 border-2',
    nameColor: 'text-yellow-400',
    shadowClass: 'shadow-xl shadow-yellow-400/10',
  },
];

const getFeatureDescription = (feature, planKey) => {
  switch (feature) {
    case 'citas':
      return planKey === 'lite' ? 'Hasta 50 citas/mes' : planKey === 'estandar' ? 'Hasta 500 citas/mes' : 'Citas ilimitadas';
    case 'pedidos':
      return planKey === 'lite' ? 'No incluido' : planKey === 'estandar' ? 'Hasta 200 pedidos/mes' : 'Pedidos ilimitados';
    case 'empleados':
      return planKey === 'lite' ? 'Hasta 2 empleados' : planKey === 'estandar' ? 'Hasta 10 empleados' : 'Empleados ilimitados';
    case 'asistente_ia':
      return planKey === 'lite' ? 'No incluido' : planKey === 'estandar' ? '100 mensajes diarios' : 'Mensajes ilimitados';
    case 'bot_whatsapp':
      return 'Agendamiento automático 24/7';
    case 'caja':
      return planKey === 'lite' ? 'Ingresos del día y mes' : 'Control completo de ingresos y egresos';
    case 'configuracion':
      return planKey === 'lite' ? 'Horarios y perfil' : 'Personalización completa';
    case 'clientes':
      return 'Historial y fidelización';
    case 'productos':
      return 'Inventario y stock';
    case 'analiticas':
      return 'Retención y comportamiento';
    case 'campanas':
      return 'Mensajes masivos a clientes';
    case 'reportes_pdf':
      return 'Reportes mensuales automáticos';
    case 'multi_sede':
      return 'Gestiona múltiples sucursales';
    default:
      return null;
  }
};

const formatFeatureName = (feature) => {
  return FEATURE_LABELS[feature] || feature.replace(/_/g, ' ');
};

export default function Planes() {
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
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black px-4 break-words overflow-hidden w-full text-center">Elige el plan perfecto para tu negocio</h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Precio de lanzamiento · 30 días gratis · Sin tarjeta de crédito
          </p>
        </div>
      </section>

      {/* PLANES */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative section-hidden">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {PLANS.map((plan) => {
              const planFeatures = PLAN_FEATURES[plan.key] || [];
              return (
                <div
                  key={plan.key}
                  className={`flex flex-col rounded-2xl border p-7 relative ${plan.bg} backdrop-blur-sm ${plan.shadowClass} ${plan.border} transition-transform hover:scale-105`}
                >
                  {plan.featured && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-xs font-bold px-4 py-1 rounded-full">
                      RECOMENDADO
                    </div>
                  )}

                  <div className="min-h-[120px] flex flex-col justify-between mb-6">
                    <div>
                      <p className={`text-2xl font-black uppercase tracking-widest mb-1 text-center ${plan.nameColor}`}>
                        {plan.name}
                      </p>
                      <div className="flex items-end justify-center gap-1 mt-2">
                        <span className="text-5xl font-black text-white">${(plan.price / 1000).toFixed(0)}k</span>
                        <span className="text-sm text-gray-400 mb-2">/mes</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 text-center">{PLAN_DESCRIPTIONS[plan.key]}</p>
                  </div>

                  <hr className="border-gray-700/50 my-4" />

                  <div className="flex-grow space-y-2.5 mb-6">
                    {planFeatures.map((feature) => (
                      <li key={feature} className="flex flex-col gap-0.5 list-none">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                          <span className="text-sm text-gray-200">{formatFeatureName(feature)}</span>
                        </div>
                        {getFeatureDescription(feature, plan.key) && (
                          <p className="text-xs text-gray-500 ml-6">
                            {getFeatureDescription(feature, plan.key)}
                          </p>
                        )}
                      </li>
                    ))}
                  </div>

                  <Link
                    to="/register"
                    className={`w-full py-3 rounded-xl font-semibold text-center transition text-sm ${
                      plan.key === 'pro'
                        ? 'bg-amber-400 hover:bg-amber-500 text-black font-bold shadow-lg shadow-amber-400/30'
                        : plan.key === 'estandar'
                          ? 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-white'
                    }`}
                  >
                    Empezar con {plan.name} →
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ENTERPRISE CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] to-violet-950/20 section-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-black">¿Necesitas algo personalizado?</h2>
          <p className="text-lg text-gray-400">
            Para empresas grandes, multi-sede o con requerimientos especiales, ofrecemos soluciones a medida.
          </p>
          <Link
            to="/enterprise"
            className="inline-block px-8 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition"
          >
            Explorar planes Enterprise →
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
