import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCOP } from '../lib/format';
import { COPY } from '../lib/copy';
import { asString, asUrls } from '../lib/safe';
import { colorsOfProduct } from '../lib/collections';
import ColorDot from './ColorDot';
import StoreImage from './StoreImage';

const MAX_DOTS = 5;
// Ancho de la tarjeta en la grilla del listado; los carruseles pasan el suyo
export const CARD_SIZES = '(min-width: 1024px) 25vw, 50vw';
// Tarjeta en ProductCarousel con su itemClass por defecto (72% / 44% / 31% / 23.5%)
export const CAROUSEL_SIZES = '(min-width: 1024px) 24vw, (min-width: 768px) 31vw, (min-width: 640px) 44vw, 72vw';

// Tarjeta estilo ALO: foto 4:5 (segunda foto en hover), puntos de color bajo la foto que cambian la
// foto a la de ese color (si existe), etiqueta "Nuevo" y estado de stock sin cifras.
// El clic lleva al producto con ?color= preseleccionado.
export default function ProductCard({ product: raw, to, eager = false, isNew = false, activeColor = '', sizes = CARD_SIZES }) {
  const name = asString(raw?.name, 'Producto');
  const images = asUrls(raw?.images);
  const colors = colorsOfProduct(raw);
  const initial = colors.find((c) => c.key === activeColor)?.key || '';
  const [selected, setSelected] = useState(initial);
  const [hover, setHover] = useState('');

  const shownKey = hover || selected;
  const shownColor = colors.find((c) => c.key === shownKey) || null;
  const main = shownColor?.image || images[0] || null;
  const second = !shownColor ? images[1] : null;
  const href = shownColor ? `${to}?color=${encodeURIComponent(shownColor.apiKey || shownColor.key)}` : to;
  const inStock = raw?.in_stock !== false;
  const lowStock = inStock && raw?.low_stock === true;

  return (
    <article className="flow-card">
      <Link to={href} className="block" aria-label={`${name}, ${formatCOP(raw?.price)}${shownColor ? `, color ${shownColor.name}` : ''}`}>
        <div className="flow-photo">
          {main ? (
            <StoreImage key={main} src={main} alt={shownColor ? `${name} en color ${shownColor.name}` : name} width="400" height="500"
              sizes={sizes} loading={eager ? 'eager' : 'lazy'} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flow-label text-flow-muted">Foto pendiente</span>
            </div>
          )}
          {second && <StoreImage src={second} alt="" aria-hidden="true" className="flow-photo-alt" width="400" height="500" sizes={sizes} />}
          <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {!inStock && <span className="bg-flow-white px-2 py-1 flow-label" style={{ fontSize: '10px' }}>{COPY.soldOut}</span>}
            {inStock && isNew && <span className="bg-flow-black px-2 py-1 flow-label text-flow-white" style={{ fontSize: '10px' }}>Nuevo</span>}
            {lowStock && <span className="bg-flow-white px-2 py-1 flow-label" style={{ fontSize: '10px' }}>Pocas unidades</span>}
          </span>
        </div>
        <div className="pt-3">
          <h3 className="text-sm font-medium leading-snug">{name}</h3>
          <p className="mt-1 text-sm text-flow-muted">{formatCOP(raw?.price)}</p>
        </div>
      </Link>
      {colors.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Colores de ${name}`}>
          {colors.slice(0, MAX_DOTS).map((c) => {
            const on = selected === c.key;
            return (
              <button key={c.key} type="button" title={c.name} aria-label={`Ver en ${c.name}`} aria-pressed={on}
                onClick={() => setSelected(on ? '' : c.key)}
                onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover('')}
                onFocus={() => setHover(c.key)} onBlur={() => setHover('')}
                className={`flex h-7 w-7 items-center justify-center rounded-full ${on ? 'ring-1 ring-flow-black' : ''} ${c.available ? '' : 'opacity-40'}`}
                style={on ? { boxShadow: '0 0 0 1px var(--flow-black)' } : undefined}>
                <ColorDot name={c.name} size={14} label={false} />
              </button>
            );
          })}
          {colors.length > MAX_DOTS && <span className="text-xs text-flow-muted">+{colors.length - MAX_DOTS}</span>}
        </div>
      )}
    </article>
  );
}
