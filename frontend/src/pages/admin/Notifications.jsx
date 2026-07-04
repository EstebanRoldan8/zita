import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Building2, AlertTriangle, Calendar, Zap, Check, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import api from '../../lib/api';

const NOTIF_CONFIG = {
  support_escalation: { label: 'Escalación de soporte', icon: AlertTriangle, color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  new_business: { label: 'Nuevo negocio', icon: Building2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  appointment_alert: { label: 'Alerta de cita', icon: Calendar, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  assistant_fail: { label: 'Fallo del asistente', icon: Zap, color: 'text-red-400 bg-red-500/10 border-red-500/20' },
};

const SYSTEM_ALERT_CONFIG = {
  wompi_plan_activation_failed: { label: 'Plan no activado', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  payment_insert_failed: { label: 'Pago no guardado', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  wompi_reconciliation_discrepancy: { label: 'Discrepancia Wompi', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  payment_declined: { label: 'Pago rechazado', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  assistant_loop_timeout: { label: 'Loop asistente', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  scheduler_autocomplete_failed: { label: 'Auto-completar falló', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  wompi_webhook_error: { label: 'Webhook Wompi error', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
};

export default function Notifications() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('notificaciones');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: () => api.get('/api/admin/notifications').then(r => r.data.data),
    refetchInterval: 30000,
  });

  const { data: systemAlerts, isLoading: systemAlertsLoading } = useQuery({
    queryKey: ['admin-system-alerts'],
    queryFn: () => api.get('/api/admin/system-alerts').then(r => r.data.data),
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`/api/admin/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries(['admin-notifications']),
  });

  const markAll = useMutation({
    mutationFn: () => Promise.all(
      (data || []).filter(n => !n.read).map(n => api.patch(`/api/admin/notifications/${n.id}/read`))
    ),
    onSuccess: () => queryClient.invalidateQueries(['admin-notifications']),
  });

  const markSystemAlertRead = useMutation({
    mutationFn: (id) => api.patch(`/api/admin/system-alerts/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries(['admin-system-alerts']),
  });

  const markAllSystemAlerts = useMutation({
    mutationFn: () => Promise.all(
      (systemAlerts || []).filter(a => !a.read_at).map(a => api.patch(`/api/admin/system-alerts/${a.id}/read`))
    ),
    onSuccess: () => queryClient.invalidateQueries(['admin-system-alerts']),
  });

  const notifications = data || [];
  const unread = notifications.filter(n => !n.read).length;
  const alerts = systemAlerts || [];
  const unreadAlerts = alerts.filter(a => !a.read_at).length;
  const totalUnread = unread + unreadAlerts;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Notificaciones</h1>
          <p className="text-slate-400 text-sm mt-1">
            {totalUnread > 0 ? `${totalUnread} sin leer` : 'Todo al día'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-white/10">
        <button
          onClick={() => setTab('notificaciones')}
          className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
            tab === 'notificaciones'
              ? 'text-violet-400 border-violet-400'
              : 'text-slate-400 border-transparent hover:text-white'
          }`}
        >
          Notificaciones
          {unread > 0 && <span className="ml-2 text-xs bg-violet-500 text-white rounded-full px-2 py-0.5">{unread}</span>}
        </button>
        <button
          onClick={() => setTab('alertas')}
          className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
            tab === 'alertas'
              ? 'text-violet-400 border-violet-400'
              : 'text-slate-400 border-transparent hover:text-white'
          }`}
        >
          Alertas del sistema
          {unreadAlerts > 0 && <span className="ml-2 text-xs bg-red-500 text-white rounded-full px-2 py-0.5">{unreadAlerts}</span>}
        </button>
      </div>

      {/* Notificaciones Tab */}
      {tab === 'notificaciones' && (
        <>
          {unread > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="mb-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm transition-all"
            >
              <CheckCheck size={15} />
              Marcar todas como leídas
            </button>
          )}
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-20 bg-[#131929] rounded-2xl animate-pulse" />)}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell size={40} className="text-slate-600 mb-3" />
              <p className="text-white font-medium mb-1">Sin notificaciones</p>
              <p className="text-slate-500 text-sm">Todo está en orden por aquí</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map(n => {
                const cfg = NOTIF_CONFIG[n.type] || NOTIF_CONFIG.appointment_alert;
                const Icon = cfg.icon;
                return (
                  <div
                    key={n.id}
                    className={`bg-[#131929] border rounded-2xl p-4 transition-all ${
                      !n.read ? 'border-violet-500/30' : 'border-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${cfg.color}`}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          {!n.read && (
                            <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
                          )}
                        </div>
                        <p className="text-slate-200 text-sm">{n.message}</p>
                        <p className="text-slate-500 text-xs mt-1.5">
                          {new Date(n.created_at).toLocaleDateString('es-CO', {
                            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                          })}
                        </p>
                      </div>
                      {!n.read && (
                        <button
                          onClick={() => markRead.mutate(n.id)}
                          className="w-8 h-8 rounded-xl bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center justify-center text-slate-500 transition-all shrink-0"
                          title="Marcar como leída"
                        >
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Alertas del Sistema Tab */}
      {tab === 'alertas' && (
        <>
          {unreadAlerts > 0 && (
            <button
              onClick={() => markAllSystemAlerts.mutate()}
              disabled={markAllSystemAlerts.isPending}
              className="mb-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm transition-all"
            >
              <CheckCheck size={15} />
              Marcar todas como leídas
            </button>
          )}
          {systemAlertsLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-20 bg-[#131929] rounded-2xl animate-pulse" />)}
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertCircle size={40} className="text-slate-600 mb-3" />
              <p className="text-white font-medium mb-1">Sin alertas</p>
              <p className="text-slate-500 text-sm">No hay problemas críticos reportados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map(a => {
                const cfg = SYSTEM_ALERT_CONFIG[a.tipo] || { label: a.tipo, color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
                return (
                  <div
                    key={a.id}
                    className={`bg-[#131929] border rounded-2xl p-4 transition-all ${
                      !a.read_at ? 'border-red-500/30' : 'border-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${cfg.color}`}>
                        <AlertCircle size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          {!a.read_at && (
                            <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                          )}
                        </div>
                        <p className="text-slate-200 text-sm">{a.mensaje}</p>
                        <p className="text-slate-500 text-xs mt-1.5">
                          {new Date(a.created_at).toLocaleDateString('es-CO', {
                            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                          })}
                        </p>
                      </div>
                      {!a.read_at && (
                        <button
                          onClick={() => markSystemAlertRead.mutate(a.id)}
                          className="w-8 h-8 rounded-xl bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center justify-center text-slate-500 transition-all shrink-0"
                          title="Marcar como leída"
                        >
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
