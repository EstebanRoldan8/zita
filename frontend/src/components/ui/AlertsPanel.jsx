import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, X, AlertCircle, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import api from '../../lib/api';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

const TYPE_CONFIG = {
  critical: { icon: AlertCircle, color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    badge: 'bg-red-500'    },
  warning:  { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', badge: 'bg-yellow-500' },
  info:     { icon: Info,          color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   badge: 'bg-blue-500'   },
};

export default function AlertsPanel() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useLockBodyScroll(open);

  const { data: alerts = [] } = useQuery({
    queryKey: ['business-alerts'],
    queryFn: () => api.get('/api/alerts').then((r) => r.data.data),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const criticalCount = alerts.filter((a) => a.type === 'critical').length;
  const badgeCount    = alerts.length;

  function handleAction(link) {
    setOpen(false);
    navigate(link);
  }

  return (
    <>
      {/* Bell button — fixed top-right */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed top-3 right-3 z-30 w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 transition shadow-lg"
      >
        <Bell size={17} className={criticalCount > 0 ? 'text-red-400' : 'text-slate-400'} />
        {badgeCount > 0 && (
          <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${criticalCount > 0 ? 'bg-red-500' : 'bg-violet-600'}`}>
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {/* Drawer overlay */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 touch-action-none"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 z-50 h-full w-80 bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div>
                <h2 className="text-white font-semibold text-sm">Alertas</h2>
                {badgeCount > 0
                  ? <p className="text-slate-500 text-xs mt-0.5">{badgeCount} activa{badgeCount > 1 ? 's' : ''}</p>
                  : <p className="text-slate-500 text-xs mt-0.5">Sin alertas activas</p>}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {alerts.length === 0 ? (
                <div className="text-center py-16">
                  <Bell size={36} className="mx-auto mb-3 text-slate-700" />
                  <p className="text-slate-500 text-sm">Todo en orden</p>
                  <p className="text-slate-700 text-xs mt-1">No hay alertas para tu negocio</p>
                </div>
              ) : (
                alerts.map((alert) => {
                  const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.info;
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={alert.code}
                      className={`rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}
                    >
                      <div className="flex items-start gap-3">
                        <Icon size={16} className={`${cfg.color} flex-shrink-0 mt-0.5`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium leading-tight">{alert.title}</p>
                          <p className="text-slate-400 text-xs mt-1 leading-relaxed">{alert.message}</p>
                          {alert.actionLink && (
                            <button
                              onClick={() => handleAction(alert.actionLink)}
                              className={`flex items-center gap-1 mt-2.5 text-xs font-medium ${cfg.color} hover:opacity-80 transition`}
                            >
                              {alert.action} <ChevronRight size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="px-5 py-3 border-t border-slate-800">
              <p className="text-slate-700 text-xs text-center">Se actualiza cada 5 minutos</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
