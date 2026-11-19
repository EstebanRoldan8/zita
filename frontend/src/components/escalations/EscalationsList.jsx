import { MessageCircle, CheckCircle2, Bot, Clock } from 'lucide-react';
import { timeAgo, displayPhone } from '../../lib/escalations';

// Lista de escalaciones (presentacional). El motivo viene del texto del cliente: se muestra SIEMPRE como texto
// de React (escapado), nunca como HTML.
export default function EscalationsList({ items, onAttend, onResumeBot, busyId = null, now }) {
  if (!items?.length) {
    return <p className="text-slate-500 text-sm py-4 text-center">Sin escalaciones por ahora.</p>;
  }
  return (
    <ul className="divide-y divide-white/5" data-testid="escalations-list">
      {items.map((e) => {
        const attended = !!e.attended_at;
        const busy = busyId === e.id;
        return (
          <li key={e.id} className={`py-3 ${attended ? 'opacity-60' : ''}`} data-escalation-id={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">
                  {e.client_name || 'Cliente sin identificar'}
                  {attended && <span className="ml-2 text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded-full">Atendida</span>}
                  {e.bot_paused && <span className="ml-2 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-full">Bot pausado</span>}
                </p>
                <p className="text-slate-400 text-xs">{displayPhone(e)}</p>
              </div>
              <span className="text-slate-500 text-xs inline-flex items-center gap-1 whitespace-nowrap">
                <Clock size={11} /> {timeAgo(e.created_at, now)}
              </span>
            </div>
            <p className="text-slate-300 text-sm mt-1 break-words whitespace-pre-wrap" data-role="motivo">{e.motivo}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {e.whatsapp_url && (
                <a
                  href={e.whatsapp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition"
                >
                  <MessageCircle size={13} /> Abrir WhatsApp
                </a>
              )}
              {!attended && (
                <button
                  type="button"
                  onClick={() => onAttend?.(e.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white transition"
                >
                  <CheckCircle2 size={13} /> Marcar atendida
                </button>
              )}
              {e.bot_paused && e.can_resume_bot && (
                <button
                  type="button"
                  onClick={() => onResumeBot?.(e.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50 transition"
                >
                  <Bot size={13} /> Reactivar bot
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
