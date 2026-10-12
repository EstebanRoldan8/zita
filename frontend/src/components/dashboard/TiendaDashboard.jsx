import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, DollarSign, TrendingUp, TrendingDown, Clock, Truck, AlertTriangle,
  Plus, PackagePlus, Package, ChevronRight,
} from 'lucide-react';
import api from '../../lib/api';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

const ORDER_STATUS = {
  recibido: { label: 'Recibido', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  en_proceso: { label: 'En proceso', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  listo: { label: 'Listo', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  enviado: { label: 'Enviado', color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  entregado: { label: 'Entregado', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  cancelado: { label: 'Cancelado', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
};
const PAYMENT_STATUS = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  pagado: { label: 'Pagado', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  fallido: { label: 'Fallido', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  reembolsado: { label: 'Reembolsado', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};

// Mismo aspecto que MetricCard del dashboard de citas
function Card({ icon: Icon, label, value, sub, valueColor = 'text-white', iconColor = 'bg-violet-600/20 text-violet-400', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    // Como <button>, la tarjeta es accesible con teclado (Tab + Enter/Espacio) y muestra el foco
    <Tag onClick={onClick} {...(onClick ? { type: 'button' } : {})}
      className={`min-w-0 text-left bg-[#131929] border border-violet-500/15 hover:border-violet-500/40 hover:bg-slate-700/60 rounded-xl shadow-lg shadow-black/30 p-4 flex flex-col transition-all duration-200 ${onClick
        ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:border-violet-400' : ''}`}>
      <div className="flex items-center justify-between w-full">
        <span className="text-slate-400 text-xs font-medium min-w-0 mr-1">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className="mt-2 min-w-0">
        <p className={`text-xl font-bold mb-1 truncate ${valueColor}`}>{value}</p>
        {sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}
      </div>
    </Tag>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 animate-pulse">
      <div className="flex justify-between mb-4">
        <div className="h-4 w-24 bg-slate-800 rounded" />
        <div className="w-9 h-9 bg-slate-800 rounded-lg" />
      </div>
      <div className="h-8 w-20 bg-slate-800 rounded" />
    </div>
  );
}

// "Negro / S": solo los valores de los atributos
const variantText = (attributes) => Object.values(attributes || {}).join(' / ') || 'Variante';
const isZero = (n) => (Number(n) || 0) === 0;

// Destino de "Reponer": abre Entrada de mercancía con el producto y, si aplica, la variante
function restockUrl(p) {
  const params = new URLSearchParams({ entrada: '1', producto: p.id });
  const lows = p.low_variants || [];
  const target = lows.find((v) => isZero(v.stock)) || lows[0];
  if (target?.id) params.set('variante', target.id);
  return `/dashboard/productos?${params.toString()}`;
}

export default function TiendaDashboard() {
  const navigate = useNavigate();

  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard-tienda'],
    queryFn: () => api.get('/api/dashboard/tienda').then((r) => r.data.data),
    refetchInterval: 60 * 1000,
  });

  // Lite no incluye los módulos de Productos ni Pedidos: solo se muestra la parte de dinero
  const isLite = sub?.plan === 'lite';

  // "Nuevo pedido" es la acción principal; las otras dos son secundarias
  const quickActions = [
    { label: 'Nuevo pedido', icon: Plus, to: '/dashboard/pedidos?nuevo=1', primary: true },
    { label: 'Entrada de mercancía', icon: PackagePlus, to: '/dashboard/productos?entrada=1' },
    { label: 'Nuevo producto', icon: Package, to: '/dashboard/productos?nuevo=1' },
  ];

  const net = data?.net_month ?? 0;
  const outProducts = data?.stock_alerts?.out_of_stock ?? 0;
  const outVariants = data?.stock_alerts?.variants_out_of_stock ?? 0;
  const lowProducts = data?.stock_alerts?.low ?? 0;
  const criticalTotal = outProducts + outVariants;
  // Productos que necesitan reposición (agotados o con stock bajo en el total o en alguna variante)
  const alertsTotal = outProducts + lowProducts;
  const alertsSub = alertsTotal === 0 ? 'Todo en orden' : [
    outVariants > 0 ? `${outVariants} variante${outVariants !== 1 ? 's' : ''} agotada${outVariants !== 1 ? 's' : ''}` : null,
    outProducts > 0 ? `${outProducts} producto${outProducts !== 1 ? 's' : ''} agotado${outProducts !== 1 ? 's' : ''}` : null,
    `${alertsTotal} por reponer`,
  ].filter(Boolean).join(' · ');
  const alertsTone = criticalTotal > 0 ? 'critical' : alertsTotal > 0 ? 'warning' : 'ok';

  return (
    <div className="zita-touch px-4 sm:px-6 lg:px-8 py-6 sm:py-8 overflow-x-hidden">
      {/* Header */}
      <div className="border-b border-white/6 pb-4 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">{getGreeting()}</h1>
        <p className="text-xs sm:text-sm text-white/40 mt-0.5">
          {new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Acciones rápidas */}
      {!isLite && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-6">
          {quickActions.map(({ label, icon: Icon, to, primary }) => (
            <button key={label} onClick={() => navigate(to)}
              className={`flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${primary
                ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/30'
                : 'bg-violet-600/10 hover:bg-violet-600/20 text-violet-300 border border-violet-500/30'}`}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      )}

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-6 flex items-center justify-between gap-3">
          <span>{error?.response?.data?.error || 'No se pudo cargar el resumen. Verifica tu conexión.'}</span>
          <button onClick={() => refetch()} className="text-xs underline flex-shrink-0">Reintentar</button>
        </div>
      )}

      {/* Tarjetas */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: isLite ? 3 : 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : data ? (
          <>
            <Card icon={ShoppingCart} label="Ventas de hoy" value={formatCOP(data.sales_today.amount)}
              sub={`${data.sales_today.count} venta${data.sales_today.count !== 1 ? 's' : ''}`}
              onClick={() => navigate('/dashboard/caja')} />
            <Card icon={DollarSign} label="Ingresos del mes" value={formatCOP(data.income_month)} sub="Total del mes"
              onClick={() => navigate('/dashboard/caja')} />
            <Card icon={net >= 0 ? TrendingUp : TrendingDown} label="Ganancia neta" value={formatCOP(net)}
              sub="Ingresos menos egresos del mes"
              valueColor={net >= 0 ? 'text-emerald-400' : 'text-red-400'}
              iconColor={net >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}
              onClick={() => navigate('/dashboard/caja')} />
            {!isLite && (
              <>
                <Card icon={Clock} label="Pedidos por cobrar" value={data.unpaid_orders.count}
                  sub={formatCOP(data.unpaid_orders.amount)}
                  valueColor={data.unpaid_orders.count > 0 ? 'text-yellow-400' : 'text-white'}
                  onClick={() => navigate('/dashboard/pedidos?pago=pendiente')} />
                <Card icon={Truck} label="Por enviar" value={data.to_ship_count} sub="Pagados sin enviar"
                  onClick={() => navigate('/dashboard/pedidos?vista=por-enviar')} />
                <Card icon={AlertTriangle} label="Alertas de stock" value={alertsTotal}
                  sub={alertsSub}
                  valueColor={alertsTone === 'critical' ? 'text-red-400' : alertsTone === 'warning' ? 'text-yellow-400' : 'text-white'}
                  iconColor={alertsTone === 'critical' ? 'bg-red-500/20 text-red-400' : alertsTone === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-violet-600/20 text-violet-400'}
                  onClick={() => navigate('/dashboard/productos?tab=inventario')} />
              </>
            )}
          </>
        ) : null}
      </div>

      {!isLite && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pedidos recientes */}
          <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-300">Pedidos recientes</h2>
              <button onClick={() => navigate('/dashboard/pedidos')} className="text-violet-400 hover:text-violet-300 text-xs transition">Ver todos →</button>
            </div>
            {data.recent_orders.length === 0 ? (
              <p className="text-slate-500 text-sm py-4 text-center">Aún no hay pedidos.</p>
            ) : (
              <div className="space-y-2">
                {data.recent_orders.map((o) => {
                  const st = ORDER_STATUS[o.status] || ORDER_STATUS.recibido;
                  const pay = PAYMENT_STATUS[o.payment_status] || PAYMENT_STATUS.pendiente;
                  return (
                    <button key={o.id} onClick={() => navigate('/dashboard/pedidos')}
                      className="w-full text-left flex items-center justify-between gap-3 p-3 bg-slate-800/30 hover:bg-slate-800/60 border border-slate-800 rounded-lg transition">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{o.client_name || '—'}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span className={`text-[11px] border px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                          {o.status !== 'cancelado' && (
                            <span className={`text-[11px] border px-2 py-0.5 rounded-full ${pay.color}`}>{pay.label}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-violet-400 font-semibold text-sm">{formatCOP(o.total_amount)}</span>
                        <ChevronRight size={14} className="text-slate-600" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {/* Más vendidos */}
            <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <TrendingUp size={14} className="text-emerald-400" /> Más vendidos 30 días
              </h2>
              {data.top_sellers.length === 0 ? (
                <p className="text-slate-500 text-sm py-2">Sin ventas en los últimos 30 días.</p>
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

            {/* Detalle de alertas de stock */}
            {data.stock_alerts.items.length > 0 && (
              <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-red-400" /> Stock por reponer
                </h2>
                <ul className="space-y-3">
                  {data.stock_alerts.items.map((p) => {
                    const lows = p.low_variants || [];
                    const productOut = isZero(p.stock);
                    // El total solo se marca como bajo si él mismo está en o bajo el mínimo;
                    // si el producto entró por una variante, el total se muestra neutro.
                    const totalLow = !productOut && Number(p.stock) <= Number(p.min_stock);
                    return (
                      <li key={p.id} className="text-sm border-b border-slate-800/60 last:border-0 pb-3 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white font-medium truncate">{p.name}</span>
                          <span className={`flex-shrink-0 ${productOut ? 'text-red-400 font-semibold' : totalLow ? 'text-yellow-400 font-semibold' : 'text-slate-300'}`}>
                            {productOut ? 'Agotado' : totalLow ? `${p.stock} / mín ${p.min_stock}` : `${p.stock} en total`}
                          </span>
                        </div>
                        {lows.length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {lows.slice(0, 4).map((v) => (
                              <li key={v.id}
                                className={`text-[13px] sm:text-xs px-2 py-1 rounded ${isZero(v.stock)
                                  ? 'text-red-300 font-semibold bg-red-500/10 border border-red-500/30'
                                  : 'text-yellow-300 bg-yellow-500/5'}`}>
                                {variantText(v.attributes)}: {v.stock} (mín {v.min_stock}){isZero(v.stock) ? ' · agotada' : ''}
                              </li>
                            ))}
                            {lows.length > 4 && <li className="text-slate-400 text-xs">y {lows.length - 4} variante{lows.length - 4 !== 1 ? 's' : ''} más</li>}
                          </ul>
                        )}
                        <button onClick={() => navigate(restockUrl(p))}
                          className="mt-2 w-full sm:w-auto text-xs font-medium text-violet-300 bg-violet-600/15 border border-violet-500/30 hover:bg-violet-600/25 px-3 py-1.5 rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                          Reponer
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
