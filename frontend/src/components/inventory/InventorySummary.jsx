import { useQuery } from '@tanstack/react-query';
import { Boxes, Wallet, Tag, AlertTriangle, TrendingUp, Moon, Info } from 'lucide-react';
import api from '../../lib/api';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function Card({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-3 md:p-4 shadow-lg shadow-black/30 min-w-0">
      <div className="flex items-center gap-1.5 text-slate-500 text-xs">
        <Icon size={13} className={accent} /> <span className="truncate">{label}</span>
      </div>
      <p className="text-white font-bold text-base md:text-lg mt-1 truncate">{value}</p>
      {sub && <p className="text-slate-500 text-[11px] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

export default function InventorySummary() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: () => api.get('/api/products/inventory-summary').then((r) => r.data?.data),
    // Ventas y ediciones del catálogo no invalidan esta query: se refresca cada vez que se abre la pestaña
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl">
        {error?.response?.data?.error || 'No se pudo cargar el resumen de inventario.'}
      </p>
    );
  }

  const alerts = (data.out_of_stock_count || 0) + (data.low_stock_count || 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card icon={Boxes} accent="text-violet-400" label="Unidades en stock"
          value={(data.total_units || 0).toLocaleString('es-CO')}
          sub={`${data.total_products} producto${data.total_products !== 1 ? 's' : ''} activo${data.total_products !== 1 ? 's' : ''}`} />
        <Card icon={Wallet} accent="text-orange-400" label="Valor al costo"
          value={formatCOP(data.inventory_cost_value)}
          sub={data.products_without_cost > 0 ? `${data.products_without_cost} sin costo` : 'Todos con costo'} />
        <Card icon={Tag} accent="text-emerald-400" label="Valor a precio de venta"
          value={formatCOP(data.inventory_sale_value)} />
        <Card icon={AlertTriangle} accent={alerts > 0 ? 'text-red-400' : 'text-slate-500'} label="Alertas de stock"
          value={alerts}
          sub={`${data.out_of_stock_count} agotado${data.out_of_stock_count !== 1 ? 's' : ''} · ${data.low_stock_count} bajo${data.low_stock_count !== 1 ? 's' : ''}`} />
      </div>

      {data.products_without_cost > 0 && (
        <p className="flex items-start gap-1.5 text-slate-500 text-xs">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          {data.products_without_cost} producto{data.products_without_cost !== 1 ? 's' : ''} no tiene{data.products_without_cost !== 1 ? 'n' : ''} precio de costo y no suma{data.products_without_cost !== 1 ? 'n' : ''} al valor al costo.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-[#131929] border border-slate-800 rounded-xl p-4">
          <h4 className="text-white text-sm font-semibold flex items-center gap-2 mb-2"><TrendingUp size={14} className="text-emerald-400" /> Más vendidos 30 días</h4>
          {data.top_sellers.length === 0 ? (
            <p className="text-slate-500 text-xs py-2">Sin ventas en los últimos 30 días.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.top_sellers.map((p, i) => (
                <li key={p.product_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-300 truncate"><span className="text-slate-600 mr-1.5">{i + 1}.</span>{p.name}</span>
                  <span className="text-emerald-400 font-semibold flex-shrink-0">{p.units} und.</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-[#131929] border border-slate-800 rounded-xl p-4">
          <h4 className="text-white text-sm font-semibold flex items-center gap-2 mb-2"><Moon size={14} className="text-slate-400" /> Sin movimiento</h4>
          {data.no_movement.length === 0 ? (
            <p className="text-slate-500 text-xs py-2">Todos los productos con stock tuvieron ventas en los últimos 30 días.</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {data.no_movement.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-300 truncate">{p.name}</span>
                    <span className="text-slate-500 flex-shrink-0">{p.stock} en stock</span>
                  </li>
                ))}
              </ul>
              {data.no_movement_total > 5 && (
                <p className="text-slate-600 text-xs mt-2">y {data.no_movement_total - 5} más sin ventas en 30 días.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
