import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import api from '../../lib/api';

const TYPE_CONFIG = {
  support_escalation: { label: 'Soporte escalado', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  new_business:       { label: 'Nuevo negocio',    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  appointment_alert:  { label: 'Alerta de cita',   color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
};

export default function Notifications() {
  const qc = useQueryClient();
  useLockBodyScroll(true);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: () => api.get('/api/admin/notifications').then((r) => r.data.data),
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => api.patch(`/api/admin/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });

  const unread = notifications.filter((n) => !n.read);

  return (
    <div className="p-4 md:p-8 overflow-hidden md:overflow-auto h-dvh md:h-auto flex flex-col">
      <div className="mb-4 md:mb-8 flex-shrink-0">
        <h1 className="text-white text-2xl font-bold">Notificaciones</h1>
        <p className="text-slate-400 text-sm mt-1">{unread.length} sin leer</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Bell size={40} className="mx-auto mb-3 opacity-30" />
            <p>Sin notificaciones</p>
          </div>
        ) : (
          <div className="space-y-2">
          {notifications.map((notif) => {
            const cfg = TYPE_CONFIG[notif.type] || { label: notif.type, color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
            return (
              <div key={notif.id}
                className={`bg-slate-900 border rounded-xl px-5 py-4 flex items-center justify-between transition ${
                  notif.read ? 'border-slate-800 opacity-50' : 'border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  {!notif.read && <div className="w-2 h-2 rounded-full bg-violet-500 mt-1.5 flex-shrink-0" />}
                  {notif.read && <div className="w-2 h-2 mt-1.5 flex-shrink-0" />}
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-white font-medium text-sm">{notif.title}</p>
                      <span className={`text-xs font-medium border px-2 py-0.5 rounded-full ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    {notif.body && <p className="text-slate-500 text-xs">{notif.body}</p>}
                    <p className="text-slate-600 text-xs mt-1">
                      {new Date(notif.created_at).toLocaleString('es-CO', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: false,
                      })}
                    </p>
                  </div>
                </div>
                {!notif.read && (
                  <button
                    onClick={() => markReadMutation.mutate(notif.id)}
                    disabled={markReadMutation.isPending}
                    className="text-slate-500 hover:text-emerald-400 p-1.5 rounded-lg hover:bg-emerald-500/10 transition flex-shrink-0"
                    title="Marcar como leída"
                  >
                    <CheckCheck size={16} />
                  </button>
                )}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}
