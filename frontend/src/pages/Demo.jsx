import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicNavbar from '../components/public/PublicNavbar';
import PublicFooter from '../components/public/PublicFooter';

export default function Demo() {
  const [pos, setPos] = useState({x: -500, y: -500});

  useEffect(() => {
    window.scrollTo(0, 0);
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

  const [negocio, setNegocio] = useState('barberia');
  const [messages, setMessages] = useState([
    { type: 'bot', text: '¡Hola! 👋 Soy ZITA, el asistente de WhatsApp. ¿Cómo puedo ayudarte hoy?' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');
    setMessages((prev) => [...prev, { type: 'user', text: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/demo/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, negocio }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { type: 'bot', text: data.response }]);
      } else {
        setMessages((prev) => [...prev, { type: 'bot', text: 'Error en la conexión. Intenta de nuevo.' }]);
      }
    } catch (error) {
      setMessages((prev) => [...prev, { type: 'bot', text: 'Error al procesar tu mensaje.' }]);
    } finally {
      setLoading(false);
    }
  };

  const negocioLabels = {
    barberia: '💈 Barbería',
    spa: '💆 Spa',
    veterinaria: '🐾 Veterinaria',
    dentista: '🦷 Dentista',
    tienda: '👗 Tienda',
    gimnasio: '💪 Gimnasio',
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden" style={{position: 'relative', overflow: 'hidden'}}>
      <PublicNavbar />


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

      <div className="pt-20">
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
      <section className="py-16 px-4 sm:px-6 lg:px-8 relative section-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black px-4 break-words overflow-hidden w-full text-center">Prueba ZITA en vivo</h1>
          <p className="text-lg text-gray-400">
            Escríbele al bot como si fueras un cliente. Así funciona ZITA en tu negocio.
          </p>
        </div>
      </section>

      {/* SELECTOR */}
      <section className="py-8 px-4 sm:px-6 lg:px-8 relative section-hidden">
        <div className="max-w-2xl mx-auto flex gap-4 justify-center flex-wrap">
          {Object.entries(negocioLabels).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setNegocio(key);
                setMessages([{ type: 'bot', text: '¡Hola! 👋 Soy ZITA, el asistente de WhatsApp. ¿Cómo puedo ayudarte hoy?' }]);
              }}
              className={`px-6 py-2 rounded-full font-semibold transition ${
                negocio === key
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-900 border border-slate-700 text-gray-300 hover:border-violet-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* CHAT */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 relative section-hidden">
        <div className="max-w-2xl mx-auto">
          <div className="bg-[#111b21] rounded-3xl overflow-hidden shadow-2xl shadow-black/50 flex flex-col h-96 sm:h-96">
            {/* Header */}
            <div className="bg-gradient-to-r from-green-700 to-green-600 px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-green-800 rounded-full flex items-center justify-center text-white font-bold text-sm">
                ZB
              </div>
              <div className="flex-1">
                <div className="font-semibold text-white text-sm">ZITA Demo · {negocioLabels[negocio]}</div>
                <div className="text-xs text-green-100 flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-100 rounded-full"></span>
                  en línea
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 bg-[#0a0e13] p-4 overflow-y-auto space-y-3 min-h-[120px] sm:min-h-[200px]">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-xs rounded-2xl px-3 py-2 text-sm ${
                      msg.type === 'user'
                        ? 'bg-gray-700 text-white rounded-tr-sm'
                        : 'bg-green-900 text-white rounded-tl-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-green-900 text-white rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
                    escribiendo...
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="bg-[#0a0e13] border-t border-gray-700 p-3 flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Escribe un mensaje..."
                className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-full px-4 py-2 text-sm placeholder-slate-500 focus:outline-none"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-full px-4 py-2 font-semibold transition"
              >
                →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* AVISO */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 relative text-center section-hidden">
        <div className="max-w-2xl mx-auto space-y-6">
          <p className="text-gray-400">
            ⚡ Esta es una demo simulada. En tu negocio real el bot agenda citas directamente en tu panel.
          </p>
          <Link
            to="/register"
            className="inline-block px-8 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition"
          >
            Empezar gratis 14 días →
          </Link>
        </div>
      </section>

      <PublicFooter />
      </div>
    </div>
  );
}
