import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Search, Phone, X } from 'lucide-react';
import api from '../../lib/api';

const inputCls = 'w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition';

// Clientes del negocio para el empleado: ver y crear (sin editar, archivar, borrar ni exportar)
export default function StaffClients() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['me', 'clients', debounced],
    queryFn: () => api.get('/api/me/clients', { params: debounced ? { search: debounced } : {} }).then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/me/clients', { name: form.name, phone: form.phone, email: form.email || null }),
    onSuccess: () => {
      setShowNew(false);
      setForm({ name: '', phone: '', email: '' });
      setError('');
      qc.invalidateQueries({ queryKey: ['me', 'clients'] });
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo crear el cliente.'),
  });

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.phone.trim()) return setError('Nombre y teléfono son obligatorios.');
    createMutation.mutate();
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-white text-xl font-bold">Clientes</h1>
          <p className="text-slate-400 text-sm">Clientes del negocio</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition whitespace-nowrap">
          <Plus size={16} /> Nuevo cliente
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o teléfono..." className={`${inputCls} pl-9`} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />)}
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p>{debounced ? 'Sin resultados' : 'Aún no hay clientes'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => (
            <div key={c.id} className="bg-[#131929] border border-violet-500/10 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-violet-600/20 text-violet-300 flex items-center justify-center font-semibold text-sm flex-shrink-0">
                {c.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{c.name}</p>
                {c.email && <p className="text-slate-500 text-xs truncate">{c.email}</p>}
              </div>
              {c.phone && (
                <a href={`tel:${c.phone}`} className="text-slate-400 hover:text-violet-300 text-xs inline-flex items-center gap-1 flex-shrink-0">
                  <Phone size={12} />{c.phone}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:px-4">
          <div className="bg-[#131929] border border-violet-500/20 md:rounded-2xl rounded-t-2xl w-full md:max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Nuevo cliente</h3>
              <button onClick={() => { setShowNew(false); setError(''); }} className="text-slate-500 hover:text-white" aria-label="Cerrar"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre *" maxLength={120} className={inputCls} />
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Teléfono *" inputMode="tel" maxLength={20} className={inputCls} />
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Correo (opcional)" type="email" maxLength={254} className={inputCls} />
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowNew(false); setError(''); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium py-2.5 rounded-lg transition">Cancelar</button>
                <button type="submit" disabled={createMutation.isPending} className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
                  {createMutation.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
