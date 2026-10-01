import { useQuery } from '@tanstack/react-query';
import { X, History } from 'lucide-react';
import api from '../../lib/api';
import {
  MOVEMENT_TYPE_LABELS, REFERENCE_LABELS, variantLabel, formatDateTimeCO, MODAL_OVERLAY, MODAL_PANEL,
} from './inventoryLabels';

export default function MovementsModal({ product, onClose }) {
  const { data: movements = [], isLoading, isError, error } = useQuery({
    queryKey: ['product-movements', product.id],
    queryFn: () => api.get(`/api/products/${product.id}/movements?limit=100`).then((r) => r.data?.data || []),
  });

  return (
    <div className={MODAL_OVERLAY}>
      <div className={`${MODAL_PANEL} md:max-w-2xl`}>
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-white font-semibold flex items-center gap-2"><History size={16} className="text-violet-400" /> Historial de inventario</h3>
            <p className="text-slate-500 text-xs mt-0.5 truncate">{product.name} · stock actual {product.stock ?? 0}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition p-1"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-slate-800/50 rounded-lg animate-pulse" />)}
            </div>
          ) : isError ? (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {error?.response?.data?.error || 'No se pudo cargar el historial.'}
            </p>
          ) : movements.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-10">Este producto aún no tiene movimientos registrados.</p>
          ) : (
            <div className="space-y-2">
              {movements.map((m) => {
                const positive = m.quantity_change > 0;
                return (
                  <div key={m.id} className="p-3 bg-slate-800/40 border border-slate-700 rounded-lg">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium">{MOVEMENT_TYPE_LABELS[m.type] || m.type}</p>
                        <p className="text-slate-500 text-xs">{formatDateTimeCO(m.created_at)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-bold ${positive ? 'text-emerald-400' : m.quantity_change < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {positive ? '+' : ''}{m.quantity_change}
                        </p>
                        <p className="text-slate-500 text-xs">Quedó en {m.stock_after}</p>
                      </div>
                    </div>
                    {(m.variant || m.reason || m.reference_type) && (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {m.variant && (
                          <span className="text-violet-300">
                            {variantLabel(m.variant.attributes)}{m.variant.sku ? ` (${m.variant.sku})` : ''}
                          </span>
                        )}
                        {m.reference_type && <span className="text-slate-500">{REFERENCE_LABELS[m.reference_type] || m.reference_type}</span>}
                        {m.reason && <span className="text-slate-400">“{m.reason}”</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              {movements.length >= 100 && (
                <p className="text-slate-600 text-xs text-center pt-2">Se muestran los 100 movimientos más recientes.</p>
              )}
            </div>
          )}
        </div>

        <div className="px-4 md:px-6 py-4 border-t border-slate-800 flex-shrink-0">
          <button onClick={onClose}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
