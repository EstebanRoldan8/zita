import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { History, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import api from '../../lib/api';
import { MOVEMENT_TYPE_LABELS, formatDateTimeCO, INPUT_CLS } from './inventoryLabels';

const TYPE_FILTERS = [
  { value: '', label: 'Todos los movimientos' },
  { value: 'venta', label: 'Ventas' },
  { value: 'ajuste', label: 'Ajustes y entradas' },
  { value: 'devolucion', label: 'Devoluciones por cancelación' },
  { value: 'deshacer', label: 'Deshacer del asistente' },
];
const PAGE_SIZE = 25;
// Sin apariencia nativa: Safari/WebKit pinta el select claro y el texto blanco no se lee
const SELECT_CLS = `${INPUT_CLS} appearance-none pr-8 cursor-pointer`;
const CHEVRON_CLS = 'absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none';

const colorTalla = (attrs) => {
  const get = (name) => Object.entries(attrs || {}).find(([k]) => k.toLowerCase() === name)?.[1];
  return [get('color'), get('talla') && `talla ${get('talla')}`].filter(Boolean).join(' · ') || Object.values(attrs || {}).join(' · ');
};

// Historial de inventario del negocio: ventas, ajustes, devoluciones y deshacer del asistente, con filtros y páginas
export default function InventoryHistory({ products = [] }) {
  const [filters, setFilters] = useState({ tipo: '', product_id: '', variant_id: '', desde: '', hasta: '' });
  const [page, setPage] = useState(1);
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const { data: variants = [] } = useQuery({
    queryKey: ['history-variants', filters.product_id],
    enabled: !!filters.product_id,
    queryFn: () => api.get(`/api/products/${filters.product_id}/variants`).then((r) => r.data?.data || []),
  });

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['inventory-history', params.toString()],
    queryFn: () => api.get(`/api/products/movements?${params}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data || [];
  const total = data?.total || 0;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="bg-[#131929] border border-slate-800 rounded-xl p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-white text-sm font-semibold flex items-center gap-2"><History size={15} className="text-violet-400" /> Historial de movimientos</h3>
        <span className="text-slate-500 text-xs">{total} movimiento{total === 1 ? '' : 's'}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
        <label className="block min-w-0 relative"><span className="sr-only">Tipo</span>
          <select aria-label="Tipo de movimiento" value={filters.tipo} onChange={(e) => set({ tipo: e.target.value })} className={SELECT_CLS}>
            {TYPE_FILTERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <ChevronDown size={14} className={CHEVRON_CLS} />
        </label>
        <label className="block min-w-0 relative"><span className="sr-only">Producto</span>
          <select aria-label="Producto" value={filters.product_id} onChange={(e) => set({ product_id: e.target.value, variant_id: '' })} className={SELECT_CLS}>
            <option value="">Todos los productos</option>
            {[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown size={14} className={CHEVRON_CLS} />
        </label>
        <label className="block min-w-0 relative"><span className="sr-only">Variante</span>
          <select aria-label="Variante" value={filters.variant_id} onChange={(e) => set({ variant_id: e.target.value })} disabled={!filters.product_id || !variants.length} className={`${SELECT_CLS} disabled:opacity-50`}>
            <option value="">{filters.product_id && variants.length ? 'Todas las variantes' : 'Variante (elige producto)'}</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{colorTalla(v.attributes)}</option>)}
          </select>
          <ChevronDown size={14} className={CHEVRON_CLS} />
        </label>
        <label className="block min-w-0"><span className="text-slate-500 text-[11px]">Desde</span>
          <input type="date" aria-label="Desde" value={filters.desde} onChange={(e) => set({ desde: e.target.value })} className={INPUT_CLS} />
        </label>
        <label className="block min-w-0"><span className="text-slate-500 text-[11px]">Hasta</span>
          <input type="date" aria-label="Hasta" value={filters.hasta} onChange={(e) => set({ hasta: e.target.value })} className={INPUT_CLS} />
        </label>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-slate-800/50 rounded-lg animate-pulse" />)}</div>
      ) : isError ? (
        <p role="alert" className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error?.response?.data?.error || 'No se pudo cargar el historial.'}</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">No hay movimientos con esos filtros.</p>
      ) : (
        <ul className={`space-y-2 ${isFetching ? 'opacity-60' : ''}`}>
          {rows.map((m) => {
            const positive = m.quantity_change > 0;
            return (
              <li key={m.id} className="p-3 bg-slate-800/40 border border-slate-700 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium break-words">{m.product_name}{m.variant ? <span className="text-violet-300 font-normal"> · {colorTalla(m.variant.attributes)}</span> : null}</p>
                    <p className="text-slate-500 text-xs">{formatDateTimeCO(m.created_at)} · {MOVEMENT_TYPE_LABELS[m.type] || m.type}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-bold ${positive ? 'text-emerald-400' : m.quantity_change < 0 ? 'text-red-400' : 'text-slate-400'}`}>{positive ? '+' : ''}{m.quantity_change}</p>
                    <p className="text-slate-500 text-xs">Quedó en {m.stock_after}</p>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className="text-slate-400">{m.origen}</span>
                  {m.pedido && <span className="text-violet-300">Pedido {m.pedido}{m.cliente ? ` · ${m.cliente}` : ''}</span>}
                  {m.reason && m.reason !== 'deshacer asistente' && <span className="text-slate-500 break-words">“{m.reason}”</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40"><ChevronLeft size={14} /> Anterior</button>
          <span className="text-slate-500 text-xs">Página {page} de {pages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(p + 1, pages))} disabled={page >= pages}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40">Siguiente <ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}
