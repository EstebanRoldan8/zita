import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Eye, EyeOff, Trash2 } from 'lucide-react';
import api from '../../lib/api';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

const emptyForm = { name: '', price: '', duration_minutes: 30, description: '' };

export default function Services() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [editService, setEditService] = useState(null);
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['services-all'],
    queryFn: () => api.get('/api/services').then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (body) => api.post('/api/services', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services-all'] }); qc.invalidateQueries({ queryKey: ['services-list'] }); setNewModal(false); },
    onError: (err) => setFormError(err.response?.data?.error || 'Error al guardar.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/api/services/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services-all'] }); qc.invalidateQueries({ queryKey: ['services-list'] }); setEditService(null); },
    onError: (err) => setFormError(err.response?.data?.error || 'Error al guardar.'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id) => api.put(`/api/services/${id}/toggle`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services-all'] }); qc.invalidateQueries({ queryKey: ['services-list'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/services/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services-all'] }); qc.invalidateQueries({ queryKey: ['services-list'] }); setDeleteConfirm(null); },
  });

  const openCreate = () => { setForm(emptyForm); setFormError(''); setEditService(null); setNewModal(true); };
  const openEdit = (svc) => {
    setForm({ name: svc.name, price: svc.price, duration_minutes: svc.duration_minutes, description: svc.description || '' });
    setEditService(svc); setFormError(''); setNewModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('El nombre es obligatorio.');
    if (!form.price || isNaN(form.price)) return setFormError('El precio debe ser un número válido.');
    const body = { name: form.name.trim(), price: parseFloat(form.price), duration_minutes: parseInt(form.duration_minutes), description: form.description };
    if (editService) updateMutation.mutate({ id: editService.id, body });
    else createMutation.mutate(body);
  };

  const sorted = [
    ...services
      .filter(s => s.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...services
      .filter(s => s.active === false)
      .sort((a, b) => a.name.localeCompare(b.name))
  ];
  const active = sorted.filter((s) => s.active !== false);
  const inactive = sorted.filter((s) => s.active === false);
  const displayedServices = showInactive ? sorted : active;

  if (active.length === 0 && !showInactive) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white text-2xl font-bold">Servicios</h1>
            <p className="text-slate-400 text-sm mt-1">0 servicios activos</p>
          </div>
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <Plus size={15} /> Nuevo servicio
          </button>
        </div>
        <div className="text-center py-20">
          <Plus size={40} className="mx-auto mb-3 text-slate-700" />
          <p className="text-slate-500">No hay servicios registrados</p>
          {newModal && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
              <div className="bg-[#1e293b] border border-white/15 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                <h3 className="text-white font-semibold text-lg mb-5">Nuevo servicio</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {formError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{formError}</p>}
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5">Nombre *</label>
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Corte clásico"
                      className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 h-11 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 text-sm mb-1.5">Precio (COP) *</label>
                      <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="35000" min={0}
                        className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 h-11 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition" />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-sm mb-1.5">Duración (min) *</label>
                      <input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} min={5} step={5}
                        className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 h-11 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5">Descripción (opcional)</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción del servicio..."
                      className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 py-2 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition resize-none h-20" />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => setNewModal(false)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition hover:bg-white/10 hover:text-white transition-colors duration-150">Cancelar</button>
                    <button type="submit" disabled={createMutation.isPending}
                      className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
                      {createMutation.isPending ? 'Guardando...' : 'Crear servicio'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="border-b border-white/6 pb-4 mb-6">
        <h1 className="text-white text-xl sm:text-2xl font-bold">Servicios <span className="text-xs sm:text-sm font-normal text-white/40 ml-2">{active.length} activo{active.length !== 1 ? 's' : ''}</span></h1>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="w-4 h-4 rounded bg-[#131929] border border-slate-700 cursor-pointer accent-violet-600"
              />
              <span className="text-slate-400 text-sm">Mostrar inactivos ({inactive.length})</span>
            </label>
            <button onClick={openCreate}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
              <Plus size={15} /> Nuevo servicio
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedServices.map((svc) => {
              const inactive = svc.active === false;
              return (
                <div key={svc.id} className={`group relative bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 rounded-xl shadow-lg shadow-black/30 overflow-hidden transition-all duration-200 flex flex-col min-h-[120px] ${inactive ? 'opacity-50' : ''}`}>
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-white font-semibold text-sm leading-tight truncate">{svc.name}</p>
                      </div>
                      {inactive ? (
                        <span className="text-xs font-medium text-slate-600 bg-[#131929] border border-slate-700 px-2 py-0.5 rounded-full flex-shrink-0">Inactivo</span>
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 mt-1" />
                      )}
                    </div>

                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-slate-500 text-xs">Precio</p>
                        <p className="text-white font-bold">{formatCOP(svc.price)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-500 text-xs">Duración</p>
                        <p className="text-white font-bold">{svc.duration_minutes} min</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto px-4 pt-2 pb-4 flex flex-col gap-2">
                    {svc.description && <p className="text-xs text-slate-500 italic">{svc.description}</p>}
                    <div className="flex gap-2 justify-end opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(svc)}
                        className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/20 transition">
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => toggleMutation.mutate(svc.id)}
                        disabled={toggleMutation.isPending}
                        className="p-2 rounded-lg text-slate-400 hover:text-yellow-400 hover:bg-yellow-500/20 transition disabled:opacity-50"
                        title={svc.active ? 'Desactivar' : 'Activar'}
                      >
                        {svc.active ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(svc)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/20 transition"
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {newModal && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
              <div className="bg-[#1e293b] border border-white/15 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                <h3 className="text-white font-semibold text-lg mb-5">{editService ? 'Editar servicio' : 'Nuevo servicio'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {formError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{formError}</p>}
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5">Nombre *</label>
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Corte clásico"
                      className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 h-11 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 text-sm mb-1.5">Precio (COP) *</label>
                      <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="35000" min={0}
                        className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 h-11 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition" />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-sm mb-1.5">Duración (min) *</label>
                      <input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} min={5} step={5}
                        className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 h-11 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1.5">Descripción (opcional)</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción del servicio..."
                      className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 py-2 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition resize-none h-20" />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => { setNewModal(false); setEditService(null); }} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">Cancelar</button>
                    <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                      className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
                      {createMutation.isPending || updateMutation.isPending ? 'Guardando...' : editService ? 'Guardar cambios' : 'Crear servicio'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {deleteConfirm && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
              <div className="bg-[#1e293b] border border-white/15 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                <h3 className="text-white font-semibold text-lg mb-4">Eliminar servicio</h3>
                <p className="text-slate-300 text-sm mb-6">
                  ¿Estás seguro que deseas eliminar <span className="font-semibold">{deleteConfirm.name}</span>? Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(null)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
                  >
                    {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
