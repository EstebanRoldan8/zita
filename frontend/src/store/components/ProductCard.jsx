import { Link } from 'react-router-dom';
import { formatCOP } from '../lib/format';
import { COPY } from '../lib/copy';

// Tarjeta: foto 4:5 (segunda foto en hover si existe), nombre, precio, chips de color y "Agotado".
export default function ProductCard({ product, to, eager = false }) {
  const [main, second] = product.images || [];
  return (
    <article className="flow-card">
      <Link to={to} className="block" aria-label={`${product.name}, ${formatCOP(product.price)}`}>
        <div className="flow-photo">
          {main ? (
            <img src={main} alt={product.name} width="400" height="500"
              loading={eager ? 'eager' : 'lazy'} decoding="async" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flow-label text-flow-muted">Foto pendiente</span>
            </div>
          )}
          {second && <img src={second} alt="" aria-hidden="true" className="flow-photo-alt" width="400" height="500" loading="lazy" decoding="async" />}
          {!product.in_stock && (
            <span className="absolute left-2 top-2 bg-flow-white px-2 py-1 flow-label">{COPY.soldOut}</span>
          )}
        </div>
        <div className="pt-4">
          <h3 className="text-sm font-medium leading-snug">{product.name}</h3>
          <p className="mt-1 text-sm text-flow-muted">{formatCOP(product.price)}</p>
        </div>
      </Link>
      {(product.colors || []).length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Colores disponibles">
          {product.colors.slice(0, 6).map((c) => (
            <li key={c.key} title={c.name}
              className={`h-4 w-4 overflow-hidden border border-flow-stone bg-flow-sand ${c.available ? '' : 'opacity-40'}`}>
              {c.image ? <img src={c.image} alt={c.name} width="16" height="16" loading="lazy" className="h-full w-full object-cover" />
                : <span className="flow-sr-only">{c.name}</span>}
            </li>
          ))}
          {product.colors.length > 6 && <li className="text-xs text-flow-muted">+{product.colors.length - 6}</li>}
        </ul>
      )}
    </article>
  );
}
