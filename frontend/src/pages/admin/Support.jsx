import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, X, Bot, User, ShieldCheck } from 'lucide-react';
import api from '../../lib/api';

const STATUS_CONFIG = {
  bot:   { label: 'Bot',    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  human: { label: 'Humano', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  closed:{ label: 'Cerrado',color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
};

const SENDER_ICON = {
  bot:        <Bot size={13} />,
  business:   <User size={13} />,
  superadmin: <ShieldCheck size={13} />,
};
const SENDER_LABEL = { bot: 'Bot', business: 'Negocio', superadmin: 'Tú' };

function ConversationPanel({ conv, onClose, isMobile }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const bottomRef = useRef(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['admin-support-detail', conv.id],
    queryFn: () => api.get(`/api/admin/support/${conv.id}`).then((r) => r.data.data),
  });

  const replyMutation = useMutation({
    mutationFn: (content) => api.post('/api/admin/support/reply', { conversation_id: conv.id, content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-support-detail', conv.id] });
      qc.invalidateQueries({ queryKey: ['admin-support'] });
      setReply('');
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    replyMutation.mutate(reply.trim());
  };

  return (
    <div className={`${isMobile ? 'fixed inset-0 z-50 md:static md:w-96' : 'w-96'} flex-shrink-0 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden`}>
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm">{conv.businesses?.name || 'Negocio'}</p>
          <p className="text-slate-500 text-xs truncate">{conv.businesses?.owner_email}</p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white p-1 transition flex-shrink-0 ml-2">
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {isLoading ? (
          <p className="text-slate-500 text-sm text-center py-8">Cargando mensajes...</p>
        ) : messages.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">Sin mensajes</p>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender === 'superadmin';
            return (
              <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs mt-0.5 ${
                  msg.sender === 'superadmin' ? 'bg-violet-600 text-white' :
                  msg.sender === 'bot' ? 'bg-blue-600/30 text-blue-400' :
                  'bg-slate-700 text-slate-300'
                }`}>
                  {SENDER_ICON[msg.sender]}
                </div>
                <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                  <span className="text-slate-500 text-[10px]">{SENDER_LABEL[msg.sender]}</span>
                  <div className={`px-3 py-2 rounded-xl text-sm ${
                    isMine
                      ? 'bg-violet-600 text-white rounded-tr-sm'
                      : 'bg-slate-800 text-slate-200 rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                  <span className="text-slate-600 text-[10px]">
                    {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply */}
      <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-slate-800">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Responder como superadmin..."
          className="flex-1 bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
        />
        <button type="submit" disabled={!reply.trim() || replyMutation.isPending}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white p-2 rounded-lg transition">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}

export default function Support() {
  const [selectedId, setSelectedId] = useState(null);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['admin-support'],
    queryFn: () => api.get('/api/admin/support').then((r) => r.data.data),
    refetchInterval: 15_000,
  });

  const selected = conversations.find((c) => c.id === selectedId);

  const open = conversations.filter((c) => c.status !== 'closed');
  const closed = conversations.filter((c) => c.status === 'closed');

  return (
    <div className="p-4 sm:p-6 md:p-8 h-screen md:h-auto flex flex-col md:block">
      <div className="mb-4 sm:mb-6 md:mb-8 flex-shrink-0">
        <h1 className="text-white text-xl sm:text-2xl font-bold">Soporte</h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">{open.length} conversaciones abiertas</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 flex-1 min-h-0">
        {/* Lista */}
        <div className={`${selected ? 'hidden md:flex-1' : 'flex-1'} flex-1 min-w-0 md:flex-initial`}>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <MessageCircle size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No hay conversaciones de soporte</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[calc(100vh-240px)] md:max-h-none overflow-y-auto">
              {[...open, ...closed].map((conv) => {
                const cfg = STATUS_CONFIG[conv.status] || STATUS_CONFIG.bot;
                const isSelected = conv.id === selectedId;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedId(isSelected ? null : conv.id)}
                    className={`w-full text-left rounded-xl px-4 sm:px-5 py-3 sm:py-4 border transition text-sm ${
                      isSelected
                        ? 'bg-violet-500/5 border-violet-500/50'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium text-sm truncate">
                          {conv.businesses?.name || 'Negocio desconocido'}
                        </p>
                        <p className="text-slate-500 text-xs truncate">
                          {conv.last_message?.content || 'Sin mensajes'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0 ml-2">
                        <span className={`text-xs font-medium border px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        <span className="text-slate-600 text-xs whitespace-nowrap hidden sm:inline">
                          {new Date(conv.created_at).toLocaleDateString('es-CO')}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Panel de conversación */}
        {selected && (
          <ConversationPanel conv={selected} onClose={() => setSelectedId(null)} isMobile={true} />
        )}
      </div>
    </div>
  );
}
