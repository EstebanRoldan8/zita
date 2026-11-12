import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Search, ShoppingCart, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import SellModal from '../../components/products/SellModal';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

const normalize = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Productos para el empleado: ver y vender. Sin costos, márgenes, inventario ni edición.
export default function StaffProducts() {
  const qc = useQueryClient();
  const { allowedModules } = useAuth();
  const [search, setSearch] = useState('');
  const [selling, setSelling] = useState(null);
  const [notice, setNotice] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['me', 'products'],
    queryFn: () => api.get('/api/me/products').then((r) => r.data.data),
  });
  const canUseClients = (allowedModules || []).includes('clientes');
  const { data: clients = [] } = useQuery({
    queryKey: ['me', 'clients', ''],
    queryFn: () => api.get('/api/me/clients').then((r) => r.data.data),
    enabled: canUseClients && !!selling,
  });

  const filtered = useMemo(() => {
    const q = normalize(search);
    return q ? products.filter((p) => normalize(p.name).includes(q) || normalize(p.category).includes(q)) : products;
  }, [products, search]);

  const stockOf = (p) => (p.has_variants ? p.variants.reduce((s, v) => s + (v.stock || 0), 0) : p.stock);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-white text-xl font-bold">Productos</h1>
        <p className="text-slate-400 text-sm">Registra las ventas que haces en el local</p>
      </div>

      {notice && (
        <p className="text-emerald-300 text-sm bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg mb-4 flex items-center gap-2">
          <CheckCircle2 size={15} /> {notice}
        </p>
      )}

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto..."
          className="w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg pl-9 pr-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Package size={40} className="mx-auto mb-3 opacity-30" />
          <p>{search ? 'Sin resultados' : 'No hay productos activos'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const stock = stockOf(p);
            return (
              <div key={p.id} className="bg-[#131929] border border-violet-500/10 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs">
                    <span className="text-violet-400">{formatCOP(p.price)}</span>
                    <span className={`ml-2 ${stock > 0 ? 'text-slate-500' : 'text-red-400'}`}>{stock > 0 ? `${stock} disponibles` : 'Agotado'}</span>
                  </p>
                </div>
                <button
                  onClick={() => { setNotice(''); setSelling(p); }}
                  disabled={stock <= 0}
                  className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-2 rounded-lg transition"
                >
                  <ShoppingCart size={14} /> Vender
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selling && (
        <SellModal
          product={selling}
          variants={selling.has_variants ? selling.variants : undefined}
          clients={clients}
          sellPath={`/api/me/products/${selling.id}/sell`}
          showChannel={false}
          onClose={() => setSelling(null)}
          onSuccess={() => {
            setNotice(`Venta de ${selling.name} registrada.`);
            setSelling(null);
            qc.invalidateQueries({ queryKey: ['me', 'products'] });
          }}
        />
      )}
    </div>
  );
}
