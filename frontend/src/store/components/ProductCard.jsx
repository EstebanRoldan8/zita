import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCOP } from '../lib/format';
import { COPY } from '../lib/copy';
import { asString, asUrls } from '../lib/safe';
import { colorsOfProduct } from '../lib/collections';
import ColorSwatches from './ColorSwatches';
import StoreImage from './StoreImage';

const MAX_DOTS = 5;
// Ancho de la tarjeta en la grilla del listado; los carruseles pasan el suyo
export const CARD_SIZES = '(min-width: 1024px) 25vw, 50vw';
// Tarjeta en ProductCarousel con su itemClass por defecto (72% / 44% / 31% / 23.5%)
export const CAROUSEL_SIZES = '(min-width: 1024px) 24vw, (min-width: 768px) 31vw, (min-width: 640px) 44vw, 72vw';

// Tarjeta estilo ALO: foto 4:5 (segunda foto en hover), puntos de color bajo la foto que cambian la
// foto a la de ese color (si existe), etiqueta "Nuevo" y estado de stock sin cifras.
// El clic lleva al producto con ?color= preseleccionado.
// colorKeys (cápsula, en orden de prioridad): la foto por defecto es la del primero de esos colores que tenga
// foto y su punto queda activo. Los puntos son TODOS los colores del producto con foto (los de la cápsula
// primero, para que el activo siempre se vea). El estado vive en la tarjeta: quien la use le pone una key por
// cápsula para que al cambiar de cápsula vuelva a su color.
export default function ProductCard({ product: raw, to, eager = false, isNew = false, activeColor = '', sizes = CARD_SIZES, colorKeys = null }) {
  const name = asString(raw?.name, 'Producto');
  const images = asUrls(raw?.images);
  const allColors = colorsOfProduct(raw);
  const capsuleColors = colorKeys ? colorKeys.map((k) => allColors.find((c) => c.key === k)).filter(Boolean) : [];
  const withPhoto = allColors.filter((c) => c.image);
  const colors = colorKeys
    ? [...new Set([...capsuleColors.filter((c) => c.image), ...(withPhoto.length ? withPhoto : allColors)])]
    : allColors;
  const fallback = colorKeys ? (capsuleColors.find((c) => c.image) || capsuleColors[0])?.key || '' : '';
  const initial = colors.find((c) => c.key === activeColor)?.key || fallback;
  const [selected, setSelectedRaw] = useState(initial);
  // En una cápsula siempre queda un color elegido: tocar el activo vuelve al de la cápsula
  const setSelected = (k) => setSelectedRaw(k || fallback);
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
      <ColorSwatches colors={colors} selected={selected} onSelect={setSelected} onPreview={setHover}
        label={`Colores de ${name}`} max={MAX_DOTS} className="mt-2" />
    </article>
  );
}
