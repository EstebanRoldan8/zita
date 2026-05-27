import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, CheckCircle, XCircle, Clock } from 'lucide-react';
import api from '../../lib/api';

const STATUS_CONFIG = {
  active:    { label: 'Activo',     color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  trial:     { label: 'Trial',      color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  suspended: { label: 'Suspendido', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
};

const TYPE_LABEL = {
  barberia:   'Barbería',
  spa:        'Spa',
  veterinaria:'Veterinaria',
  dentista:   'Dentista',
  otro:       'Otro',
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.trial;
  return (
    <span className={`text-xs font-medium border px-2.5 py-0.5 rounded-full ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

export default function Businesses() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: businesses = [], isLoading } = useQuery({
    queryKey: ['admin-businesses'],
    queryFn: () => api.get('/api/admin/businesses').then((r) => r.data.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/api/admin/businesses/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-businesses'] }),
  });

  const toggleStatus = (biz) => {
    const next = biz.status === 'suspended' ? 'active' : 'suspended';
    updateMutation.mutate({ id: biz.id, status: next });
  };

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-white text-xl sm:text-2xl font-bold">Negocios</h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">{businesses.length} negocios registrados</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : businesses.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay negocios registrados</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {['Negocio', 'Tipo', 'Email', 'Registro', 'Estado', 'Acciones'].map((h) => (
                    <th key={h} className="text-left text-slate-500 font-medium px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {businesses.map((biz) => (
                  <tr key={biz.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{biz.name}</p>
                      {biz.phone && <p className="text-slate-500 text-xs">{biz.phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{TYPE_LABEL[biz.business_type] || biz.business_type}</td>
                    <td className="px-4 py-3 text-slate-400">{biz.owner_email}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(biz.created_at).toLocaleDateString('es-CO')}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={biz.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleStatus(biz)}
                          disabled={updateMutation.isPending}
                          title={biz.status === 'suspended' ? 'Activar' : 'Suspender'}
                          className={`p-1.5 rounded-lg transition ${
                            biz.status === 'suspended'
                              ? 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10'
                              : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'
                          }`}
                        >
                          {biz.status === 'suspended' ? <CheckCircle size={15} /> : <XCircle size={15} />}
                        </button>
                        <button
                          onClick={() => navigate(`/admin/negocios/${biz.id}`)}
                          className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-700/50 transition"
                          title="Ver detalle"
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {businesses.map((biz) => (
              <div key={biz.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium text-sm truncate">{biz.name}</p>
                    {biz.phone && <p className="text-slate-500 text-xs mt-0.5">{biz.phone}</p>}
                  </div>
                  <StatusBadge status={biz.status} />
                </div>
                <div className="space-y-2 mb-3 text-xs">
                  <p className="text-slate-400"><span className="text-slate-500">Tipo:</span> {TYPE_LABEL[biz.business_type] || biz.business_type}</p>
                  <p className="text-slate-400"><span className="text-slate-500">Email:</span> {biz.owner_email}</p>
                  <p className="text-slate-400"><span className="text-slate-500">Registro:</span> {new Date(biz.created_at).toLocaleDateString('es-CO')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleStatus(biz)}
                    disabled={updateMutation.isPending}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition ${
                      biz.status === 'suspended'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}
                  >
                    {biz.status === 'suspended' ? (
                      <>
                        <CheckCircle size={14} />
                        Activar
                      </>
                    ) : (
                      <>
                        <XCircle size={14} />
                        Suspender
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => navigate(`/admin/negocios/${biz.id}`)}
                    className="py-2 px-3 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition border border-slate-700 text-xs font-medium"
                  >
                    Detalle
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
