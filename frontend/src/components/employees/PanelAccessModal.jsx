import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Link2, Copy, Check, RefreshCw, ShieldOff, MessageCircle } from 'lucide-react';
import api from '../../lib/api';
import { ACCESS_LABELS } from './accessLabels';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Navegadores sin Clipboard API (o sin permiso): copia con un textarea temporal
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

// Invitar a un empleado a su panel, reenviar enlace o revocar acceso (solo dueño).
// El enlace solo se puede ver al generarlo: el backend guarda únicamente su hash.
export default function PanelAccessModal({ employee, onClose }) {
  const qc = useQueryClient();
  const [invite, setInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState('');
  const status = invite ? 'invited' : (employee.access_status || 'none');

  const inviteMutation = useMutation({
    mutationFn: () => api.post(`/api/employees/${employee.id}/invite`).then((r) => r.data.data),
    onSuccess: (data) => {
      setError('');
      setCopied(false);
      setInvite(data);
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo generar el enlace.'),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete(`/api/employees/${employee.id}/access`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo revocar el acceso.'),
  });

  const handleCopy = async () => {
    if (!invite) return;
    const ok = await copyText(invite.link);
    setCopied(ok);
    if (!ok) setError('No se pudo copiar. Mantén presionado el enlace para copiarlo.');
  };

  const expires = invite?.expires_at
    ? new Date(invite.expires_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })
    : null;
  const badge = ACCESS_LABELS[status] || ACCESS_LABELS.none;
  const busy = inviteMutation.isPending || revokeMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:px-4">
      <div className="bg-[#131929] border border-violet-500/25 md:rounded-2xl rounded-t-2xl w-full md:max-w-md p-6 shadow-2xl shadow-black/50 max-h-[100dvh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-white font-semibold text-lg">Acceso al panel</h3>
            <p className="text-slate-400 text-sm mt-0.5">
              {employee.name}
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition" aria-label="Cerrar"><X size={18} /></button>
        </div>

        {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-4">{error}</p>}

        {invite ? (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">
              Envíale este enlace a {employee.name}. Sirve una sola vez{expires ? ` y vence el ${expires}` : ''}.
            </p>
            <div className="bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-slate-300 break-all select-all">
              {invite.link}
            </div>
            {invite.whatsapp_url && (
              <a
                href={invite.whatsapp_url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 rounded-lg transition"
              >
                <MessageCircle size={16} /> Enviar por WhatsApp
              </a>
            )}
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              {copied ? <><Check size={16} /> Enlace copiado</> : <><Copy size={16} /> Copiar enlace</>}
            </button>
            {!invite.whatsapp_url && (
              <p className="text-slate-500 text-xs">Sin celular válido registrado: copia el enlace y envíalo tú.</p>
            )}
            <button
              onClick={() => inviteMutation.mutate()}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              <RefreshCw size={15} /> Generar nuevo enlace
            </button>
          </div>
        ) : status === 'active' ? (
          <p className="text-slate-300 text-sm mb-2">
            {employee.name} ya entra a su panel con su propio correo. Ve sus citas, clientes, productos y sus comisiones; nada de caja, analíticas ni configuración.
          </p>
        ) : status === 'invited' ? (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">
              Ya hay una invitación pendiente. Por seguridad no guardamos el enlace: si lo necesitas otra vez, genera uno nuevo (el anterior deja de servir).
            </p>
            <button
              onClick={() => inviteMutation.mutate()}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              <RefreshCw size={15} /> {inviteMutation.isPending ? 'Generando...' : 'Generar nuevo enlace'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">
              Invita a {employee.name} a su panel: verá su agenda, podrá marcar citas como hechas, registrar clientes y ventas de productos, y consultar sus comisiones.
            </p>
            <button
              onClick={() => inviteMutation.mutate()}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              <Link2 size={16} /> {inviteMutation.isPending ? 'Generando...' : 'Invitar al panel'}
            </button>
          </div>
        )}

        {status !== 'none' && (
          <div className="mt-5 pt-4 border-t border-slate-800">
            {confirmRevoke ? (
              <div className="space-y-2">
                <p className="text-slate-300 text-sm">
                  {status === 'active'
                    ? `${employee.name} perderá el acceso de inmediato y su cuenta se eliminará.`
                    : 'El enlace pendiente dejará de servir.'}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmRevoke(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm py-2 rounded-lg transition">
                    Cancelar
                  </button>
                  <button
                    onClick={() => revokeMutation.mutate()}
                    disabled={busy}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition"
                  >
                    {revokeMutation.isPending ? 'Revocando...' : 'Sí, revocar'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRevoke(true)}
                className="w-full flex items-center justify-center gap-2 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 text-sm py-2 rounded-lg transition"
              >
                <ShieldOff size={15} /> Revocar acceso
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
