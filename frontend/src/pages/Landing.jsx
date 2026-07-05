import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import PublicNavbar from '../components/public/PublicNavbar';
import PublicFooter from '../components/public/PublicFooter';

export default function Landing() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [visibleSections, setVisibleSections] = useState({});
  const [chatPhase, setChatPhase] = useState(1);
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [stats, setStats] = useState({ responses: 0, ai: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [scroll, setScroll] = useState(0);
  const landingRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setScroll((window.scrollY / total) * 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisibleSections((prev) => ({
            ...prev,
            [entry.target.id]: true,
          }));
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('[data-animate]').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const chatInterval = setInterval(() => {
      setChatPhase((prev) => (prev === 1 ? 2 : 1));
    }, 7000);
    return () => clearInterval(chatInterval);
  }, []);

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const faqs = [
    {
      q: '¿Necesito saber de tecnología para usar ZITA?',
      a: 'No. La configuración inicial toma menos de 10 minutos y te guiamos paso a paso.',
    },
    {
      q: '¿Necesito tener cuenta de WhatsApp Business?',
      a: 'Sí, necesitas una cuenta de WhatsApp Business con tu número de negocio. Te ayudamos a configurarla.',
    },
    {
      q: '¿Qué pasa cuando termina el período de prueba?',
      a: 'Puedes elegir el plan que más te convenga. Si no quieres continuar, no se cobra nada.',
    },
    {
      q: '¿Puedo cambiar de plan después?',
      a: 'Sí, puedes subir o bajar de plan en cualquier momento desde tu panel de configuración.',
    },
    {
      q: '¿Mis datos están seguros?',
      a: 'Todos los datos están encriptados y almacenados de forma segura. Nunca compartimos tu información.',
    },
  ];

  const testimonials = [
    {
      initials: 'CR',
      color: 'bg-violet-600',
      name: 'Carlos Rodríguez',
      business: 'Barbería El Estilo · Cali',
      quote: 'Antes perdía clientes porque no podía contestar mientras cortaba. Ahora ZITA agenda solo y yo me enfoco en mi trabajo.',
    },
    {
      initials: 'AM',
      color: 'bg-green-600',
      name: 'Andrea Mejía',
      business: 'Spa Serenidad · Cali',
      quote: 'El bot entiende a mis clientes perfectamente. Ya no tengo que estar pendiente del WhatsApp todo el día.',
    },
    {
      initials: 'JM',
      color: 'bg-blue-600',
      name: 'Julián Morales',
      business: 'Barbería Premium · Cali',
      quote: 'En el primer mes recuperé el costo con las citas que antes perdía. ZITA se paga sola.',
    },
  ];

  return (
    <div ref={landingRef} className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
      <PublicNavbar />

      {/* BARRA DE SCROLL */}
      <div
        className="fixed top-0 left-0 z-50 transition-all duration-100"
        style={{
          height: '3px',
          width: `${scroll}%`,
          background: 'linear-gradient(to right, #7c3aed, #a78bfa)',
        }}
      />

      {/* GLOW DE MOUSE */}
      <div
        style={{
          position: 'fixed',
          left: `${mousePos.x - 150}px`,
          top: `${mousePos.y - 150}px`,
          width: '300px',
          height: '300px',
          background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 1,
          transition: 'left 0.3s ease, top 0.3s ease',
        }}
      />

      {/* PARTÍCULAS */}
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

      {/* Fondo gradiente mesh sutil */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-violet-900/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/3 left-1/3 w-96 h-96 bg-violet-800/10 rounded-full blur-3xl"></div>
      </div>


      {/* HERO */}
      <section className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 pt-20 relative overflow-hidden bg-gradient-to-b from-violet-950/30 via-[#0a0a0f] to-[#0a0a0f]">
        <div className="max-w-7xl mx-auto w-full relative z-10">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* COLUMNA IZQUIERDA */}
            <div className="space-y-8 animate-fade-in text-center lg:text-left">
              <div className="inline-block lg:inline-block">
                <div className="px-4 py-2 rounded-full border border-violet-500/50 bg-violet-500/10 text-sm text-violet-300 backdrop-blur">
                  🤖 Powered by IA · WhatsApp
                </div>
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black leading-tight">
                Atiende a tus clientes.
                <span className="block bg-gradient-to-r from-violet-500 to-violet-600 bg-clip-text text-transparent">
                  ZITA se encarga del resto.
                </span>
              </h1>

              <p className="text-lg sm:text-xl text-gray-400 max-w-2xl lg:max-w-none">
                El asistente de WhatsApp con IA que agenda citas, procesa pedidos y gestiona tu negocio completo, 24/7
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start pt-6">
                <Link
                  to="/register"
                  className="px-8 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition text-center hover:shadow-lg hover:shadow-violet-500/50"
                >
                  Empezar gratis 30 días
                </Link>
                <button
                  onClick={() => scrollToSection('como-funciona')}
                  className="px-8 py-3 border border-violet-500 text-white rounded-lg hover:bg-violet-500/10 transition font-semibold"
                >
                  Ver cómo funciona
                </button>
              </div>
            </div>

            {/* COLUMNA DERECHA - MOCK ANIMADO */}
            <div className="lg:flex justify-center hidden h-96">
              {chatPhase === 1 ? (
                <div className="w-full max-w-sm bg-[#111b21] rounded-3xl overflow-hidden shadow-2xl shadow-black/50 animate-fade-in">
                  {/* Header WhatsApp */}
                  <div className="bg-gradient-to-r from-green-700 to-green-600 px-4 py-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-800 rounded-full flex items-center justify-center text-white font-bold text-sm">
                      ZB
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-white text-sm">ZITA · Barbería Test</div>
                      <div className="text-xs text-green-100 flex items-center gap-1">
                        <span className="w-2 h-2 bg-green-100 rounded-full"></span>
                        en línea
                      </div>
                    </div>
                  </div>

                  {/* Chat */}
                  <div className="h-80 bg-[#0a0e13] p-4 overflow-hidden flex flex-col justify-end space-y-3">
                    <div className="flex justify-end animate-fadeInUp" style={{ animationDelay: '0.5s', animationFillMode: 'both' }}>
                      <div className="max-w-xs bg-gray-700 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
                        Hola! quiero un corte clásico mañana
                      </div>
                    </div>
                    <div className="flex justify-start animate-fadeInUp" style={{ animationDelay: '1s', animationFillMode: 'both' }}>
                      <div className="max-w-xs bg-green-900 text-white rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
                        ¡Hola! 👋 ¿A qué hora te queda bien?
                      </div>
                    </div>
                    <div className="flex justify-end animate-fadeInUp" style={{ animationDelay: '1.8s', animationFillMode: 'both' }}>
                      <div className="max-w-xs bg-gray-700 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
                        A las 3pm
                      </div>
                    </div>
                    <div className="flex justify-start animate-fadeInUp" style={{ animationDelay: '2.5s', animationFillMode: 'both' }}>
                      <div className="max-w-xs bg-green-900 text-white rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
                        ✅ Corte clásico mañana a las 3:00 PM - $25.000 💈<br />¿A qué nombre?
                      </div>
                    </div>
                    <div className="flex justify-end animate-fadeInUp" style={{ animationDelay: '3.5s', animationFillMode: 'both' }}>
                      <div className="max-w-xs bg-gray-700 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
                        Juan García
                      </div>
                    </div>
                    <div className="flex justify-start animate-fadeInUp" style={{ animationDelay: '4.2s', animationFillMode: 'both' }}>
                      <div className="max-w-xs bg-green-900 text-white rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
                        ¡Confirmado Juan! Te esperamos mañana a las 3pm 🎉
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-sm bg-gradient-to-br from-slate-900/50 to-slate-800/30 rounded-3xl overflow-hidden shadow-2xl shadow-black/50 animate-fade-in">
                  {/* Header Panel */}
                  <div className="bg-slate-900 border-b border-violet-500/20 px-4 py-4 flex items-center gap-3">
                    <img src="/logo.png" alt="ZITA" className="h-6 w-6" />
                    <div className="font-semibold text-white text-sm">ZITA Panel</div>
                  </div>

                  {/* Tarjeta de cita */}
                  <div className="h-80 bg-[#0a0e13] p-6 flex items-center justify-center">
                    <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 border border-green-500/30 rounded-2xl p-6 w-full space-y-4">
                      <div className="flex items-center gap-2 text-green-400">
                        <span className="text-2xl">✅</span>
                        <span className="font-bold">Nueva cita agendada</span>
                      </div>
                      <div className="space-y-3 text-sm text-gray-300">
                        <div>
                          <span className="text-gray-500">Cliente:</span>
                          <span className="ml-2 font-semibold text-white">Juan García</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Servicio:</span>
                          <span className="ml-2 font-semibold text-white">Corte clásico · $25.000</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Hora:</span>
                          <span className="ml-2 font-semibold text-white">Mañana 3:00 PM</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Empleado:</span>
                          <span className="ml-2 font-semibold text-white">Miguel López</span>
                        </div>
                      </div>
                      <div className="inline-block bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        Confirmada
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-center mt-12 pt-8 animate-bounce">
            <ChevronDown className="text-violet-400" size={32} />
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative" data-animate id="stats">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8">
            <div className="text-center space-y-2">
              <div className="text-4xl font-black text-violet-400">⚡</div>
              <div className="text-3xl font-black">&lt;2s</div>
              <p className="text-gray-400 text-sm">Tiempo de respuesta del bot</p>
            </div>
            <div className="text-center space-y-2">
              <div className="text-4xl font-black text-green-400">🕐</div>
              <div className="text-3xl font-black">24/7</div>
              <p className="text-gray-400 text-sm">Siempre disponible</p>
            </div>
            <div className="text-center space-y-2">
              <div className="text-4xl font-black text-blue-400">🤖</div>
              <div className="text-3xl font-black">Claude AI</div>
              <p className="text-gray-400 text-sm">Motor de inteligencia</p>
            </div>
            <div className="text-center space-y-2">
              <div className="text-4xl font-black text-yellow-400">🇨🇴</div>
              <div className="text-3xl font-black">Cali</div>
              <p className="text-gray-400 text-sm">Hecho en Colombia</p>
            </div>
          </div>
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section id="como-funciona" className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] to-blue-950/20" data-animate>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center mb-4 px-4">
            Tan fácil como mandar un mensaje
          </h2>
          <p className="text-center text-gray-400 mb-16 max-w-2xl mx-auto">
            Tres simples pasos para automatizar tu negocio
          </p>

          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-1/2 left-1/4 right-1/4 h-0.5 border-t-2 border-dashed border-violet-500/30 transform -translate-y-1/2"></div>

            <div className="space-y-4">
              <div className="text-6xl font-black bg-gradient-to-r from-violet-400 to-green-400 bg-clip-text text-transparent hover:scale-110 transition-transform duration-300">
                01
              </div>
              <h3 className="text-xl font-bold">Tu cliente escribe por WhatsApp</h3>
              <p className="text-gray-400">Cualquier mensaje, en cualquier momento.</p>
            </div>

            <div className="space-y-4">
              <div className="text-6xl font-black bg-gradient-to-r from-violet-400 to-green-400 bg-clip-text text-transparent hover:scale-110 transition-transform duration-300">
                02
              </div>
              <h3 className="text-xl font-bold">ZITA entiende, responde y agenda</h3>
              <p className="text-gray-400">La IA maneja todo automáticamente, 24/7.</p>
            </div>

            <div className="space-y-4">
              <div className="text-6xl font-black bg-gradient-to-r from-violet-400 to-green-400 bg-clip-text text-transparent hover:scale-110 transition-transform duration-300">
                03
              </div>
              <h3 className="text-xl font-bold">Tú ves todo en tu panel</h3>
              <p className="text-gray-400">Dashboard inteligente, métricas en tiempo real.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] via-blue-950/10 to-[#0a0a0f]" data-animate>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center mb-16 px-4">
            Todo lo que necesita tu negocio
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-5 sm:p-8 hover:translate-y-[-4px] transition-all duration-300 shadow-lg">
              <div className="w-10 h-10 sm:w-16 sm:h-16 bg-green-500/20 rounded-full flex items-center justify-center text-3xl sm:text-4xl mb-4 sm:mb-6 mx-auto">
                💬
              </div>
              <h3 className="text-lg sm:text-2xl font-bold text-center mb-2 sm:mb-3">Bot WhatsApp 24/7</h3>
              <p className="text-gray-400 text-center mb-4 sm:mb-6 text-sm sm:text-base">Tu número de WhatsApp atiende solo, sin que tú estés pendiente.</p>
              <ul className="space-y-2 text-xs sm:text-sm text-gray-300">
                <li>• Agenda citas automáticamente</li>
                <li>• Responde preguntas de clientes</li>
                <li className="hidden sm:block">• Funciona de noche y fines de semana</li>
              </ul>
            </div>

            <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-5 sm:p-8 hover:translate-y-[-4px] transition-all duration-300 shadow-lg">
              <div className="w-10 h-10 sm:w-16 sm:h-16 bg-violet-500/20 rounded-full flex items-center justify-center text-3xl sm:text-4xl mb-4 sm:mb-6 mx-auto">
                📊
              </div>
              <h3 className="text-lg sm:text-2xl font-bold text-center mb-2 sm:mb-3">Panel Inteligente</h3>
              <p className="text-gray-400 text-center mb-4 sm:mb-6 text-sm sm:text-base">Citas, pedidos, caja, clientes y empleados. Todo en un solo lugar, en cualquier dispositivo.</p>
              <ul className="space-y-2 text-xs sm:text-sm text-gray-300">
                <li>• Citas y pedidos en un lugar</li>
                <li>• Métricas en tiempo real</li>
                <li className="hidden sm:block">• Gestión de empleados</li>
              </ul>
            </div>

            <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-5 sm:p-8 hover:translate-y-[-4px] transition-all duration-300 shadow-lg">
              <div className="w-10 h-10 sm:w-16 sm:h-16 bg-blue-500/20 rounded-full flex items-center justify-center text-3xl sm:text-4xl mb-4 sm:mb-6 mx-auto">
                ✨
              </div>
              <h3 className="text-lg sm:text-2xl font-bold text-center mb-2 sm:mb-3">Asistente IA</h3>
              <p className="text-gray-400 text-center mb-4 sm:mb-6 text-sm sm:text-base">Dile en español lo que necesitas y el asistente lo hace por ti.</p>
              <ul className="space-y-2 text-xs sm:text-sm text-gray-300">
                <li>• Crea citas con un mensaje</li>
                <li>• Registra ventas al instante</li>
                <li className="hidden sm:block">• Consulta métricas conversando</li>
              </ul>
            </div>

            <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-5 sm:p-8 hover:translate-y-[-4px] transition-all duration-300 shadow-lg">
              <div className="w-10 h-10 sm:w-16 sm:h-16 bg-orange-500/20 rounded-full flex items-center justify-center text-3xl sm:text-4xl mb-4 sm:mb-6 mx-auto">
                📦
              </div>
              <h3 className="text-lg sm:text-2xl font-bold text-center mb-2 sm:mb-3">Gestión de pedidos</h3>
              <p className="text-gray-400 text-center mb-4 sm:mb-6 text-sm sm:text-base">Recibe y gestiona pedidos por WhatsApp. Tu cliente pide, ZITA lo registra y tú lo preparas.</p>
              <ul className="space-y-2 text-xs sm:text-sm text-gray-300">
                <li>• Estados: recibido → proceso → entregado</li>
                <li>• Notificaciones automáticas</li>
                <li className="hidden sm:block">• Historial de pedidos completo</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIOS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 bg-gradient-to-b from-violet-950/20 via-[#0a0a0f] to-[#0a0a0f]" data-animate>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center mb-16 px-4">
            Lo que dicen nuestros clientes
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8 hover:translate-y-[-4px] transition-all duration-300">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`${t.color} w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg`}>
                    {t.initials}
                  </div>
                  <div>
                    <div className="font-bold text-white">{t.name}</div>
                    <div className="text-xs text-gray-400">{t.business}</div>
                  </div>
                </div>
                <p className="text-gray-300 mb-4 text-sm">{t.quote}</p>
                <div className="text-yellow-400 text-sm">⭐⭐⭐⭐⭐</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLANES */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 bg-gradient-to-b from-violet-950/30 via-[#0a0a0f] to-[#0a0a0f]" data-animate>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center mb-4 px-4">
            Precios que caben en cualquier negocio
          </h2>
          <p className="text-center text-gray-400 mb-16">
            Precio de lanzamiento · Garantizado mientras sigas activo
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 hover:translate-y-[-4px] transition-all duration-300">
              <h3 className="text-2xl font-bold mb-2 text-slate-300">Lite</h3>
              <div className="text-4xl font-black mb-6">
                $69K<span className="text-lg text-gray-400">/mes</span>
              </div>
              <ul className="space-y-3 mb-8 text-gray-300 text-sm">
                <li>✓ Bot WhatsApp con tu número</li>
                <li>✓ Hasta 300 citas al mes</li>
                <li>✓ Hasta 2 empleados</li>
                <li>✓ Caja básica (ingresos del día y mes)</li>
                <li>✓ Configuración de horarios</li>
              </ul>
              <p className="text-xs text-gray-500 mb-4">Sin asistente IA</p>
              <Link
                to="/register"
                className="w-full py-3 border border-slate-600 rounded-lg hover:border-slate-400 transition font-semibold text-center block hover:bg-slate-800/50"
              >
                Empezar con Lite
              </Link>
            </div>

            <div className="bg-gradient-to-br from-violet-950/40 to-slate-900 border-2 border-violet-500 rounded-2xl p-8 relative md:scale-105 hover:translate-y-[-4px] transition-all duration-300 shadow-lg shadow-violet-500/20">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-1 rounded-full text-xs font-bold text-white">
                RECOMENDADO
              </div>
              <h3 className="text-2xl font-bold mb-2 text-violet-400">Estándar</h3>
              <div className="text-4xl font-black mb-6">
                $119K<span className="text-lg text-gray-400">/mes</span>
              </div>
              <ul className="space-y-3 mb-8 text-gray-300 text-sm">
                <li>✓ Todo lo del plan Lite</li>
                <li>✓ Hasta 700 citas al mes</li>
                <li>✓ Hasta 5 empleados</li>
                <li>✓ Panel completo (caja, clientes, productos)</li>
                <li>✓ Asistente IA (20 mensajes/día)</li>
                <li>✓ Analíticas de retención</li>
              </ul>
              <Link
                to="/register"
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg hover:from-violet-700 hover:to-violet-800 transition font-semibold text-center block"
              >
                Empezar con Estándar
              </Link>
            </div>

            <div className="bg-gradient-to-br from-yellow-950/30 to-slate-900 border-2 border-yellow-500/50 rounded-2xl p-8 hover:translate-y-[-4px] transition-all duration-300 shadow-lg shadow-yellow-500/10">
              <h3 className="text-2xl font-bold mb-2 text-yellow-400">Pro</h3>
              <div className="text-4xl font-black mb-6">
                $199K<span className="text-lg text-gray-400">/mes</span>
              </div>
              <ul className="space-y-3 mb-8 text-gray-300 text-sm">
                <li>✓ Todo lo del plan Estándar</li>
                <li>✓ Citas y pedidos ilimitados</li>
                <li>✓ Empleados ilimitados</li>
                <li>✓ Asistente IA (60 mensajes/día)</li>
                <li>✓ Campañas WhatsApp masivas</li>
                <li>✓ Reportes PDF automáticos</li>
                <li>✓ Multi-sede (próximamente)</li>
              </ul>
              <Link
                to="/register"
                className="w-full py-3 border border-yellow-500/50 rounded-lg hover:border-yellow-400 hover:bg-yellow-500/10 transition font-semibold text-center block"
              >
                Empezar con Pro
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* PARA QUIÉN ES */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5" data-animate>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center mb-16 px-4">
            Para cualquier negocio que atiende clientes
          </h2>

          <div className="flex flex-wrap justify-center gap-4">
            {[
              { emoji: '💈', name: 'Barberías', color: 'hover:text-violet-400' },
              { emoji: '💆', name: 'Spas', color: 'hover:text-pink-400' },
              { emoji: '🐾', name: 'Veterinarias', color: 'hover:text-green-400' },
              { emoji: '🦷', name: 'Dentistas', color: 'hover:text-blue-400' },
              { emoji: '👗', name: 'Tiendas', color: 'hover:text-orange-400' },
              { emoji: '💪', name: 'Gimnasios', color: 'hover:text-red-400' },
            ].map((chip) => (
              <div
                key={chip.name}
                className={`px-6 py-3 bg-violet-900/20 border border-violet-500/30 rounded-full text-sm font-medium hover:border-violet-400/50 hover:bg-violet-900/40 transition ${chip.color}`}
              >
                {chip.emoji} {chip.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 bg-black" data-animate>
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-center mb-16 px-4">
            Preguntas frecuentes
          </h2>

          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenFaqIndex(openFaqIndex === i ? null : i)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-800/50 transition font-semibold text-left"
                >
                  {faq.q}
                  {openFaqIndex === i ? (
                    <ChevronUp size={20} className="text-violet-400" />
                  ) : (
                    <ChevronDown size={20} className="text-gray-500" />
                  )}
                </button>
                {openFaqIndex === i && (
                  <div className="px-6 py-4 border-t border-slate-700 text-gray-300 bg-slate-900/20">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative border-t border-white/5 bg-gradient-to-b from-[#0a0a0f] to-violet-950/30" data-animate>
        <div className="max-w-4xl mx-auto bg-gradient-to-r from-violet-600/20 to-violet-500/20 border border-violet-500/30 rounded-3xl p-8 sm:p-12 text-center space-y-6 hover:border-violet-400/50 transition">
          <h2 className="text-2xl sm:text-3xl lg:text-5xl font-black w-full text-center break-words px-4">
            ¿Listo para automatizar tu negocio?
          </h2>
          <p className="text-sm sm:text-lg text-gray-300">
            30 días gratis. Sin tarjeta de crédito.
          </p>
          <Link
            to="/register"
            className="inline-block px-8 py-4 bg-violet-600 text-white rounded-lg font-bold hover:bg-violet-700 transition hover:shadow-lg hover:shadow-violet-500/50 whitespace-nowrap"
          >
            Empezar gratis →
          </Link>
          <p className="text-gray-400 pt-4">
            ¿Tienes dudas?{' '}
            <a
              href="https://wa.me/573183790317"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:text-violet-300 transition"
            >
              Escríbenos por WhatsApp
            </a>
          </p>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
