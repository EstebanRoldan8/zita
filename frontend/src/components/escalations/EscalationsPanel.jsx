import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Headset } from 'lucide-react';
import api from '../../lib/api';
import { sortEscalations } from '../../lib/escalations';
import EscalationsList from './EscalationsList';

const VISIBLE = 5;

// Sección del dashboard del DUEÑO: clientes que pidieron hablar con una persona (escalaciones del bot).
// Solo se monta en el dashboard del dueño (/dashboard, ProtectedRoute role="owner"); la API también rechaza al empleado.
export default function EscalationsPanel() {
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['escalations'],
    queryFn: () => api.get('/api/escalations').then((r) => r.data.data),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const action = useMutation({
    mutationFn: ({ id, kind }) => api.post(`/api/escalations/${id}/${kind}`),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['escalations'] }); },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo completar la acción.'),
  });

  const items = sortEscalations(data?.items);
  const open = data?.open_count || 0;
  if (!items.length) return null;

  const visible = showAll ? items : items.slice(0, VISIBLE);

  return (
    <section className="bg-[#131929] border border-violet-500/20 rounded-xl p-4 mb-6" aria-labelledby="escalations-title">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 id="escalations-title" className="text-white font-semibold text-sm flex items-center gap-2">
          <Headset size={16} className="text-violet-400" />
          Clientes que pidieron hablar contigo
          {open > 0 && (
            <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold inline-flex items-center justify-center" aria-label={`${open} sin atender`}>
              {open}
            </span>
          )}
        </h2>
      </div>
      <p className="text-slate-500 text-xs mb-2">El bot se pausa 3 horas con ese cliente para que le escribas tú.</p>
      {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-2">{error}</p>}
      <EscalationsList
        items={visible}
        busyId={action.isPending ? action.variables?.id : null}
        onAttend={(id) => action.mutate({ id, kind: 'attend' })}
        onResumeBot={(id) => action.mutate({ id, kind: 'resume-bot' })}
      />
      {items.length > VISIBLE && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-violet-400 hover:text-violet-300 text-xs mt-2">
          {showAll ? 'Ver menos' : `Ver todas (${items.length})`}
        </button>
      )}
    </section>
  );
}
