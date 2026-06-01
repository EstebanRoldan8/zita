import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, X, AlertCircle, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import api from '../../lib/api';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

const TYPE_CONFIG = {
  critical: { icon: AlertCircle, color: 'text-red-400',    borderLeft: 'border-l-red-500',    linkColor: 'text-red-400' },
  warning:  { icon: AlertTriangle, color: 'text-yellow-400', borderLeft: 'border-l-yellow-500', linkColor: 'text-yellow-400' },
  info:     { icon: Info,          color: 'text-blue-400',   borderLeft: 'border-l-blue-500',   linkColor: 'text-blue-400' },
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
        className="fixed top-4 right-4 md:top-3 md:right-3 z-30 w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 transition shadow-lg"
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
          <div className="fixed inset-x-4 top-16 md:top-0 md:right-0 md:inset-auto z-50 md:h-full w-auto md:w-80 bg-[#1e293b] border border-white/15 md:border-l md:border-t-0 md:border-r-0 md:border-b-0 rounded-2xl md:rounded-none shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <h2 className="text-white font-bold text-base">Alertas</h2>
                {badgeCount > 0 && (
                  <span className="bg-violet-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
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
                      className={`bg-white/3 border border-white/8 border-l-4 rounded-xl p-4 ${cfg.borderLeft}`}
                    >
                      <div className="flex items-start gap-3">
                        <Icon size={18} className={`${cfg.color} flex-shrink-0 mt-0.5`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm">{alert.title}</p>
                          <p className="text-gray-400 text-xs mt-1">{alert.message}</p>
                          {alert.actionLink && (
                            <button
                              onClick={() => handleAction(alert.actionLink)}
                              className={`flex items-center gap-1 mt-2 text-xs font-medium ${cfg.linkColor} hover:opacity-80 transition`}
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
            <div className="px-4 py-3 border-t border-white/10">
              <p className="text-gray-600 text-xs text-center">Se actualiza cada 5 minutos</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
