import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Bot, User, Shield, ArrowLeft, Clock, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return new Date(date).toLocaleDateString('es-CO');
}

export default function Support() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState('');
  const messagesEndRef = useRef(null);

  const { data: conversations } = useQuery({
    queryKey: ['admin-support'],
    queryFn: () => api.get('/api/admin/support/conversations').then(r => r.data.data),
    refetchInterval: 15000,
  });

  const { data: messages } = useQuery({
    queryKey: ['admin-support-messages', selected?.id],
    queryFn: () => api.get(`/api/admin/support/conversations/${selected.id}/messages`).then(r => r.data.data),
    enabled: !!selected?.id,
    refetchInterval: 10000,
  });

  const sendMutation = useMutation({
    mutationFn: () => api.post(`/api/admin/support/conversations/${selected.id}/messages`, {
      content: reply, sender: 'superadmin'
    }),
    onSuccess: () => {
      setReply('');
      queryClient.invalidateQueries(['admin-support-messages', selected?.id]);
      queryClient.invalidateQueries(['admin-support']);
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const open = (conversations || []).filter(c => c.status !== 'closed');
  const closed = (conversations || []).filter(c => c.status === 'closed');

  const SenderIcon = ({ sender }) => {
    if (sender === 'bot') return <Bot size={14} className="text-violet-400" />;
    if (sender === 'superadmin') return <Shield size={14} className="text-emerald-400" />;
    return <User size={14} className="text-slate-400" />;
  };

  return (
    <div className="flex h-[calc(100vh-64px)] md:h-screen">
      {/* Lista conversaciones */}
      <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-white/10 bg-[#0f0f17]`}>
        <div className="p-4 border-b border-white/10">
          <h1 className="text-white font-bold text-lg">Soporte</h1>
          <p className="text-slate-500 text-xs mt-0.5">{open.length} conversaciones abiertas</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {open.length === 0 && closed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <MessageSquare size={32} className="text-slate-600 mb-2" />
              <p className="text-slate-500 text-sm">Sin conversaciones</p>
            </div>
          ) : (
            <>
              {open.length > 0 && (
                <>
                  <p className="text-xs text-slate-500 px-2 py-1 font-medium">Abiertas</p>
                  {open.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        selected?.id === c.id
                          ? 'bg-violet-600/20 border border-violet-500/30'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-white text-sm font-medium truncate">{c.businesses?.name || 'Negocio'}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          c.status === 'bot'
                            ? 'bg-violet-500/10 text-violet-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {c.status === 'bot' ? 'Bot' : 'Humano'}
                        </span>
                      </div>
                      <p className="text-slate-500 text-xs truncate">{c.last_message || 'Sin mensajes'}</p>
                      <p className="text-slate-600 text-xs mt-1">{timeAgo(c.created_at)}</p>
                    </button>
                  ))}
                </>
              )}
              {closed.length > 0 && (
                <>
                  <p className="text-xs text-slate-500 px-2 py-1 font-medium mt-3">Cerradas</p>
                  {closed.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className={`w-full text-left p-3 rounded-xl transition-all opacity-60 ${
                        selected?.id === c.id
                          ? 'bg-white/10 border border-white/20'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <p className="text-slate-300 text-sm font-medium truncate">{c.businesses?.name || 'Negocio'}</p>
                      <p className="text-slate-500 text-xs truncate">{c.last_message || 'Sin mensajes'}</p>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Panel mensajes */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-[#0f0f17]">
            <button
              onClick={() => setSelected(null)}
              className="md:hidden w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-400"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold">{selected.businesses?.name || 'Negocio'}</p>
              <p className="text-slate-500 text-xs">{selected.businesses?.owner_email}</p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full border ${
              selected.status === 'closed'
                ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                : selected.status === 'bot'
                ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}>
              {selected.status === 'bot' ? 'Bot activo' : selected.status === 'human' ? 'Humano' : 'Cerrada'}
            </span>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(messages || []).map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.sender === 'superadmin' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  m.sender === 'superadmin' ? 'bg-emerald-500/20' :
                  m.sender === 'bot' ? 'bg-violet-500/20' : 'bg-slate-700'
                }`}>
                  <SenderIcon sender={m.sender} />
                </div>
                <div className={`max-w-xs lg:max-w-md ${m.sender === 'superadmin' ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                    m.sender === 'superadmin'
                      ? 'bg-emerald-600 text-white rounded-tr-sm'
                      : m.sender === 'bot'
                      ? 'bg-violet-600/20 border border-violet-500/20 text-slate-200 rounded-tl-sm'
                      : 'bg-[#1e293b] text-slate-200 rounded-tl-sm'
                  }`}>
                    {m.content}
                  </div>
                  <p className="text-slate-600 text-xs mt-1 px-1">{timeAgo(m.created_at)}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {selected.status !== 'closed' && (
            <div className="p-4 border-t border-white/10 bg-[#0f0f17]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && reply.trim() && sendMutation.mutate()}
                  placeholder="Escribe tu respuesta..."
                  className="flex-1 px-4 py-2.5 bg-[#131929] border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
                />
                <button
                  onClick={() => sendMutation.mutate()}
                  disabled={!reply.trim() || sendMutation.isPending}
                  className="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center text-white transition-all"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-center">
          <div>
            <MessageSquare size={48} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">Selecciona una conversación</p>
            <p className="text-slate-600 text-sm mt-1">para ver los mensajes</p>
          </div>
        </div>
      )}
    </div>
  );
}
