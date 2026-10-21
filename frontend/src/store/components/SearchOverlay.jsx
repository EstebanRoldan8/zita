import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useCatalog } from '../hooks/useCatalog';
import { useStorePath } from '../hooks/useStore';
import { filterProducts, firstImage } from '../lib/collections';
import { formatCOP } from '../lib/format';
import StoreImage from './StoreImage';

// Buscador a pantalla completa: filtra en el cliente sobre el catálogo ya cargado
// (nombre, categoría, colores). Sin llamadas nuevas al backend. Esc cierra.
export default function SearchOverlay({ onClose }) {
  const path = useStorePath();
  const catalog = useCatalog();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const query = q.trim();
  const results = query.length >= 2 ? filterProducts(catalog.data || [], { q: query }).slice(0, 24) : [];

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-flow-white" role="dialog" aria-modal="true" aria-label="Buscar productos">
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 md:px-8">
        <div className="flex items-center gap-3 border-b border-flow-black pb-3">
          <Search size={20} strokeWidth={1.5} aria-hidden="true" />
          <label htmlFor="flow-search" className="flow-sr-only">Buscar</label>
          <input id="flow-search" ref={inputRef} type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por producto, categoría o color" maxLength={60} autoComplete="off"
            className="min-h-12 w-full bg-transparent text-lg outline-none" style={{ fontSize: 18 }} />
          <button type="button" onClick={onClose} aria-label="Cerrar buscador" className="flex h-11 w-11 flex-shrink-0 items-center justify-center">
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>

        <div className="mt-8" aria-live="polite">
          {query.length < 2 ? (
            <p className="text-sm text-flow-muted">Escribe al menos 2 letras.</p>
          ) : catalog.isLoading ? (
            <p className="text-sm text-flow-muted">Cargando productos…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-flow-muted">No encontramos productos para “{query}”.</p>
          ) : (
            <>
              <p className="flow-label mb-6 text-flow-muted">{results.length} resultado{results.length !== 1 ? 's' : ''}</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
                {results.map((p) => {
                  const img = firstImage(p);
                  return (
                    <li key={p.id}>
                      <Link to={path(`/producto/${p.id}`)} onClick={onClose} className="block">
                        <div className="flow-photo">
                          {img ? <StoreImage src={img} alt={p.name} width="400" height="500" sizes="(min-width: 768px) 25vw, 50vw" />
                            : <span className="absolute inset-0 flex items-center justify-center flow-label text-flow-muted">Sin foto</span>}
                        </div>
                        <p className="mt-3 text-sm font-medium">{p.name}</p>
                        <p className="text-sm text-flow-muted">{formatCOP(p.price)}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
