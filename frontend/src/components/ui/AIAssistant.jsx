import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, X, Send, Loader2, Zap } from 'lucide-react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';

const WELCOME = '¡Hola! Soy el asistente de ZITA. Puedo crear citas, consultar métricas, registrar ventas y más. ¿En qué te ayudo?';

const ACTION_LABELS = {
  crear_cita:                  'Cita creada',
  consultar_metricas:          'Métricas consultadas',
  listar_citas:                'Citas listadas',
  cancelar_cita:               'Cita cancelada',
  registrar_venta_producto:    'Venta registrada',
  consultar_clientes_inactivos:'Clientes consultados',
  crear_cliente:               'Cliente creado',
  contactar_soporte:           'Soporte contactado',
};

export default function AIAssistant() {
  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then(r => r.data.data),
    staleTime: 5 * 60 * 1000
  });

  const queryClient = useQueryClient();
  const [open, setOpen]               = useState(false);
  const [displayMessages, setDisplay] = useState([
    { role: 'assistant', text: WELCOME, actions: [] },
  ]);
  const [apiHistory, setApiHistory]   = useState([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [isMobile, setIsMobile]       = useState(window.matchMedia('(max-width: 768px)').matches);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const panelRef   = useRef(null);
  useLockBodyScroll(open && isMobile);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handleChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages, loading]);

  useEffect(() => {
    if (!open) return;
    const handleViewportResize = () => {
      setViewportHeight(window.visualViewport?.height || window.innerHeight);
    };
    window.visualViewport?.addEventListener('resize', handleViewportResize);
    return () => window.visualViewport?.removeEventListener('resize', handleViewportResize);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setDisplay((prev) => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const { data } = await api.post('/api/assistant/message', {
        message: text,
        history: apiHistory,
      });
      setApiHistory(data.data.history);
      setDisplay((prev) => [...prev, {
        role:    'assistant',
        text:    data.data.response,
        actions: data.data.actionsExecuted || [],
      }]);

      const actions = data.data.actionsExecuted || [];

      if (actions.includes('crear_cita') || actions.includes('cancelar_cita')) {
        queryClient.invalidateQueries({ queryKey: ['appointments'] });
      }
      if (actions.includes('crear_cliente')) {
        queryClient.invalidateQueries({ queryKey: ['clients'] });
      }
      if (actions.includes('registrar_venta_producto') || actions.includes('eliminar_producto')) {
        queryClient.invalidateQueries({ queryKey: ['products'] });
      }
      if (actions.includes('crear_cita') || actions.includes('registrar_venta_producto')) {
        queryClient.invalidateQueries({ queryKey: ['metrics-overview'] });
        queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      }
      if (actions.includes('desactivar_servicio') || actions.includes('activar_servicio')) {
        queryClient.invalidateQueries({ queryKey: ['services'] });
      }
      if (actions.includes('activar_producto') || actions.includes('desactivar_producto')) {
        queryClient.invalidateQueries({ queryKey: ['products'] });
      }
    } catch {
      setDisplay((prev) => [...prev, {
        role: 'assistant',
        text: 'Lo siento, tuve un problema al procesar tu mensaje. Intenta de nuevo.',
        actions: [],
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const { user: authData } = useAuth ? useAuth() : {};
  const isSuperadmin = authData?.email === import.meta.env.VITE_SUPERADMIN_EMAIL;
  if (sub?.plan === 'lite' && !isSuperadmin) return null;

  return (
    <>
      {/* Botón toggle — esquina inferior derecha */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Asistente ZITA"
        className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-30 w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-[0_4px_20px_rgba(124,58,237,0.5)] hover:scale-105 transition-transform"
      >
        {open ? (
          <X size={20} className="text-white" />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2L4.5 13.5H11L10 22L19.5 10H13L13 2Z"/>
          </svg>
        )}
      </button>

      {/* Panel de chat */}
      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-0 left-0 right-0 sm:inset-auto sm:bottom-24 sm:right-5 z-40 flex flex-col bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden sm:w-80 sm:h-96 md:w-96 md:h-[480px]"
          style={{ height: 'min(70vh, 70dvh)', maxHeight: `${viewportHeight}px` }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 sm:px-4 py-3 sm:py-3 border-b border-violet-500/20 flex-shrink-0 bg-[#0a0f1e] sticky top-0 z-10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 2L4.5 13.5H11L10 22L19.5 10H13L13 2Z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs sm:text-sm font-semibold leading-tight">Asistente ZITA</p>
              <p className="text-violet-400 text-[10px] sm:text-xs">Con IA · Claude</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/50 hover:text-white transition flex-shrink-0 p-0.5"
            >
              <X size={16} className="sm:w-[15px] sm:h-[15px]" />
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-3 py-3 sm:py-3 space-y-2 sm:space-y-3">
            {displayMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-1 sm:gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {/* Avatar asistente */}
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 2L4.5 13.5H11L10 22L19.5 10H13L13 2Z"/>
                    </svg>
                  </div>
                )}

                <div className={`flex flex-col gap-1 max-w-[85%] sm:max-w-[82%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-br-sm'
                      : msg.error
                        ? 'bg-red-500/10 border border-red-500/20 text-red-300 rounded-tl-sm'
                        : 'bg-violet-950/40 border border-violet-500/15 text-white/90 rounded-tl-sm'
                  }`}>
                    {msg.text}
                  </div>

                  {/* Badges de acciones ejecutadas */}
                  {msg.actions?.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 sm:gap-1">
                      {msg.actions.map((a, j) => (
                        <span
                          key={j}
                          className="flex items-center gap-0.5 text-[9px] sm:text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 sm:px-2 py-0.5 rounded-full"
                        >
                          <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-emerald-400 rounded-full inline-block" />
                          {ACTION_LABELS[a.tool] || a.tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Indicador "escribiendo..." */}
            {loading && (
              <div className="flex gap-1 sm:gap-2 justify-start">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13 2L4.5 13.5H11L10 22L19.5 10H13L13 2Z"/>
                  </svg>
                </div>
                <div className="bg-violet-950/40 border border-violet-500/15 rounded-xl rounded-tl-sm px-2.5 sm:px-3 py-1.5 sm:py-2.5 flex items-center gap-1">
                  <Loader2 size={12} className="sm:w-[13px] sm:h-[13px] text-violet-400 animate-spin" />
                  <span className="text-white/70 text-xs">Escribiendo...</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 sm:px-3 py-3 sm:py-3 border-t border-slate-800 flex-shrink-0 bg-[#1e293b] sticky bottom-0 z-10" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}>
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Escribe un mensaje..."
                rows={1}
                style={{ maxHeight: '72px', overflowY: 'auto' }}
                className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 sm:py-2.5 text-xs sm:text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition resize-none"
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="w-9 h-9 sm:w-9 sm:h-9 flex-shrink-0 flex items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition"
              >
                <Send size={16} className="sm:w-[14px] sm:h-[14px]" />
              </button>
            </div>
            <p className="text-slate-700 text-[8px] sm:text-[10px] text-center mt-1.5 leading-tight">
              Enter para enviar · Shift+Enter para nueva línea
            </p>
          </div>
        </div>
      )}
    </>
  );
}
