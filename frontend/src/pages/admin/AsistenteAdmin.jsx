import { useState, useEffect, useRef } from 'react';
import { Send, Bot, Loader2, Zap, Trash2 } from 'lucide-react';
import api from '../../lib/api';

export default function AsistenteAdmin() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '¡Hola Esteban! Soy tu asistente superadmin. Puedo hacer tests del sistema, analizar métricas de toda la plataforma, revisar negocios y más. ¿En qué te ayudo?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await api.post('/api/assistant/message', {
        message: userMsg,
        conversationHistory: history
      });
      const assistantMsg = res.data.data?.response || 'Sin respuesta';
      setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);
      setHistory(res.data.data?.history || []);
    } catch(e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Hubo un error. Intenta de nuevo.' }]);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setMessages([{ role: 'assistant', content: '¡Hola Esteban! Soy tu asistente superadmin. ¿En qué te ayudo?' }]);
    setHistory([]);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0f0f17]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <Zap size={18} className="text-violet-400" />
          </div>
          <div>
            <p className="text-white font-semibold">Asistente ZITA</p>
            <p className="text-slate-500 text-xs">Superadmin · Claude Haiku</p>
          </div>
        </div>
        <button
          onClick={clear}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs transition-all"
        >
          <Trash2 size={13} />
          Limpiar
        </button>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {m.role === 'assistant' && (
              <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                <Bot size={16} className="text-violet-400" />
              </div>
            )}
            <div className={`max-w-2xl ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-violet-600 text-white rounded-tr-sm'
                  : 'bg-[#131929] border border-white/10 text-slate-200 rounded-tl-sm'
              }`}>
                {m.content}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-violet-400" />
            </div>
            <div className="bg-[#131929] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
              <Loader2 size={16} className="text-violet-400 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sugerencias rápidas */}
      {messages.length <= 1 && (
        <div className="px-6 pb-3 flex flex-wrap gap-2">
          {[
            'Haz un test completo del sistema',
            '¿Cómo está la plataforma hoy?',
            'Muéstrame métricas del mes',
            '¿Cuántos negocios en trial?',
          ].map(s => (
            <button
              key={s}
              onClick={() => setInput(s)}
              className="px-3 py-1.5 rounded-xl bg-violet-600/10 border border-violet-500/20 text-violet-300 text-xs hover:bg-violet-600/20 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-white/10 bg-[#0f0f17]">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Pregúntame algo sobre ZITA..."
            className="flex-1 px-4 py-3 bg-[#131929] border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="w-11 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center text-white transition-all"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
