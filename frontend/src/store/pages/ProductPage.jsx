import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { storeApi } from '../lib/storeApi';
import { formatCOP, attrValue, optionKey, COLOR_KEYS, SIZE_KEYS } from '../lib/format';
import { COPY, POLICY_FALLBACK } from '../lib/copy';
import { ErrorState, PageNotFound } from '../components/States';

const SIZE_ORDER = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];
const sizeRank = (s) => {
  const i = SIZE_ORDER.indexOf(String(s).toLowerCase());
  return i === -1 ? 100 + (Number(s) || 0) : i;
};
const variantText = (attributes) => Object.values(attributes || {}).join(' / ');

// Se monta con key = fotos del color elegido: al cambiar de color arranca en la primera foto
function Gallery({ images, name }) {
  const [active, setActive] = useState(0);
  const scroller = useRef(null);

  const goTo = (i) => {
    setActive(i);
    const el = scroller.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
  };

  if (images.length === 0) {
    return <div className="flow-photo"><div className="absolute inset-0 flex items-center justify-center"><span className="flow-label text-flow-muted">Foto pendiente</span></div></div>;
  }

  return (
    <div>
      {/* Swipe en móvil (scroll-snap); en desktop se navega con las miniaturas */}
      <div ref={scroller} className="flow-snap flex overflow-x-auto"
        onScroll={(e) => { const el = e.currentTarget; setActive(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))); }}
        aria-label={`Fotos de ${name}`}>
        {images.map((src, i) => (
          <div key={src} className="flow-photo w-full flex-shrink-0">
            <img src={src} alt={`${name}, foto ${i + 1} de ${images.length}`} width="800" height="1000"
              loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Miniaturas">
          {images.map((src, i) => (
            <button key={src} type="button" role="tab" aria-selected={i === active} aria-label={`Ver foto ${i + 1}`}
              onClick={() => goTo(i)}
              className={`flow-photo w-16 flex-shrink-0 border ${i === active ? 'border-flow-black' : 'border-transparent'}`}>
              <img src={src} alt="" width="64" height="80" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProductPage() {
  const { id } = useParams();
  const { slug, store } = useStore();
  const path = useStorePath();
  const { add, setOpen, isFull } = useCart();

  const { data: p, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['store', slug, 'product', id],
    queryFn: () => storeApi.getProduct(slug, id),
    retry: (count, err) => err?.response?.status !== 404 && count < 2,
  });

  // Lo que eligió la persona; los valores efectivos (colorKey, size, qty) se derivan abajo
  const [pickedColor, setColorKey] = useState('');
  const [pickedSize, setSize] = useState('');
  const [optionId, setOptionId] = useState(''); // variantes sin color ni talla
  const [pickedQty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useDocumentMeta(p ? `${p.name} — ${store.name || 'Flow'}` : store.name || 'Flow',
    p?.description?.slice(0, 150) || COPY.essence, p?.images?.[0]);

  // Variantes con su color (clave normalizada) y talla
  const variants = useMemo(() => (p?.variants || []).map((v) => {
    const colorName = attrValue(v.attributes, COLOR_KEYS);
    return { ...v, colorKey: colorName ? optionKey(colorName) : '', colorName, size: attrValue(v.attributes, SIZE_KEYS) };
  }), [p]);
  const hasVariants = variants.length > 0;
  const colors = useMemo(() => p?.colors || [], [p]);
  const hasColor = colors.length > 0;
  const sizes = useMemo(() => {
    const seen = new Map();
    for (const v of variants) if (v.size && !seen.has(v.size.toLowerCase())) seen.set(v.size.toLowerCase(), v.size);
    return [...seen.values()].sort((a, b) => sizeRank(a) - sizeRank(b));
  }, [variants]);
  const hasSize = sizes.length > 0;
  const genericOptions = hasVariants && !hasColor && !hasSize;

  // Si hay un solo color disponible, queda elegido sin que la persona lo toque
  const availableColors = colors.filter((c) => c.available);
  const colorKey = pickedColor || (hasColor && availableColors.length === 1 ? availableColors[0].key : '');

  const sizeAvailable = (s) => variants.some((v) => v.available && v.size === s && (!hasColor || !colorKey || v.colorKey === colorKey));
  // Una talla elegida que no existe en el color actual deja de contar
  const size = pickedSize && sizeAvailable(pickedSize) ? pickedSize : '';

  const selected = useMemo(() => {
    if (!hasVariants) return null;
    if (genericOptions) return variants.find((v) => v.id === optionId) || null;
    return variants.find((v) => (!hasColor || v.colorKey === colorKey) && (!hasSize || v.size === size)) || null;
  }, [variants, hasVariants, genericOptions, optionId, hasColor, colorKey, hasSize, size]);

  const maxQty = hasVariants ? (selected?.available ? selected.max_qty : 0) : (p?.in_stock ? p.max_qty ?? 10 : 0);
  const qty = Math.max(1, Math.min(pickedQty, maxQty || 1));

  const gallery = useMemo(() => {
    if (!p) return [];
    const byColor = colorKey ? p.images_by_color?.[colorKey] : null;
    return byColor && byColor.length > 0 ? byColor : (p.images || []);
  }, [p, colorKey]);

  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 md:grid-cols-2 md:px-8" aria-busy="true">
        <div className="flow-skeleton" style={{ aspectRatio: '4 / 5' }} />
        <div><div className="flow-skeleton h-8 w-2/3" /><div className="flow-skeleton mt-4 h-5 w-1/4" /></div>
      </div>
    );
  }
  if (error?.response?.status === 404) return <PageNotFound homePath={path('/coleccion')} />;
  if (isError || !p) return <ErrorState message="No pudimos cargar este producto." onRetry={refetch} />;

  const needsColor = hasColor && !colorKey;
  const needsSize = hasSize && !size;
  const needsOption = genericOptions && !optionId;
  const soldOut = hasVariants ? !variants.some((v) => v.available) : !p.in_stock;
  const canAdd = !soldOut && !needsColor && !needsSize && !needsOption && maxQty > 0 && !isFull && (!hasVariants || !!selected?.available);
  const colorName = colors.find((c) => c.key === colorKey)?.name || selected?.colorName || '';

  const handleAdd = () => {
    if (!canAdd) return;
    add({
      product_id: p.id,
      variant_id: selected?.id || null,
      name: p.name,
      price: p.price,
      image: gallery[0] || p.images?.[0] || null,
      color: colorName || null,
      size: selected?.size || (genericOptions ? variantText(selected?.attributes) : null),
      quantity: qty,
      max_qty: maxQty,
    });
    setAdded(true);
    setOpen(true);
  };

  const policies = store.policies || {};

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <nav className="flow-label mb-6 text-flow-muted" aria-label="Ruta">
        <Link to={path('/coleccion')} className="hover:underline">Tienda</Link>
        {p.category && <> <span aria-hidden="true">/</span> <Link to={`${path('/coleccion')}?categoria=${encodeURIComponent(p.category)}`} className="hover:underline">{p.category}</Link></>}
      </nav>

      <div className="grid gap-10 md:grid-cols-2 md:gap-16">
        <Gallery key={gallery.join('|')} images={gallery} name={p.name} />

        <div>
          <h1 className="flow-serif text-3xl leading-tight md:text-4xl">{p.name}</h1>
          <p className="mt-3 text-lg">{formatCOP(p.price)}</p>
          {soldOut ? (
            <p className="flow-label mt-4 text-flow-merlot">{COPY.soldOut}</p>
          ) : p.low_stock ? (
            <p className="flow-label mt-4 text-flow-merlot">{COPY.lowStock}</p>
          ) : null}

          <hr className="flow-rule my-8" />

          {hasColor && (
            <fieldset className="mb-8">
              <legend className="flow-label mb-3">{COPY.chooseColor}{colorName ? `: ${colorName}` : ''}</legend>
              <div className="flex flex-wrap gap-3">
                {colors.map((c) => (
                  <label key={c.key} title={c.name} className={`flow-swatch ${c.available ? '' : 'is-unavailable'}`}>
                    <input type="radio" name="flow-color" value={c.key} checked={colorKey === c.key}
                      onChange={() => setColorKey(c.key)} aria-label={`${c.name}${c.available ? '' : ' (agotado)'}`} />
                    {c.image ? <img src={c.image} alt="" width="44" height="44" className="h-full w-full object-cover" loading="lazy" />
                      : <span className="flex h-full w-full items-center justify-center text-[10px] uppercase">{c.name.slice(0, 3)}</span>}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {hasSize && (
            <fieldset className="mb-8">
              <legend className="flow-label mb-3">{COPY.chooseSize}</legend>
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => {
                  const ok = sizeAvailable(s);
                  return (
                    <label key={s} className="flow-option">
                      <input type="radio" name="flow-size" value={s} checked={size === s} disabled={!ok}
                        onChange={() => setSize(s)} aria-label={`Talla ${s}${ok ? '' : ' (agotada)'}`} />
                      {s}
                    </label>
                  );
                })}
              </div>
              {needsColor && <p className="mt-2 text-xs text-flow-muted">Elige un color para ver las tallas disponibles.</p>}
            </fieldset>
          )}

          {genericOptions && (
            <fieldset className="mb-8">
              <legend className="flow-label mb-3">Elige una opción</legend>
              <div className="flex flex-wrap gap-2">
                {variants.map((v) => (
                  <label key={v.id} className="flow-option">
                    <input type="radio" name="flow-option" value={v.id} checked={optionId === v.id} disabled={!v.available}
                      onChange={() => setOptionId(v.id)} />
                    {variantText(v.attributes) || 'Opción'}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {!soldOut && (
            <div className="mb-8">
              <p className="flow-label mb-3" id="flow-qty-label">Cantidad</p>
              <div className="inline-flex items-center border border-flow-stone" role="group" aria-labelledby="flow-qty-label">
                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1}
                  aria-label="Quitar una unidad" className="flex h-12 w-12 items-center justify-center disabled:opacity-30">
                  <Minus size={14} strokeWidth={1.5} />
                </button>
                <span className="w-10 text-center" aria-live="polite">{qty}</span>
                <button type="button" onClick={() => setQty(Math.min(maxQty || 1, qty + 1))} disabled={!maxQty || qty >= maxQty}
                  aria-label="Agregar una unidad" className="flex h-12 w-12 items-center justify-center disabled:opacity-30">
                  <Plus size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}

          <button type="button" onClick={handleAdd} disabled={!canAdd} className="flow-btn flow-btn-primary w-full">
            {soldOut ? COPY.soldOut : COPY.addToBag}
          </button>
          {!soldOut && (needsColor || needsSize || needsOption) && (
            <p className="mt-3 text-xs text-flow-muted">
              {needsColor ? 'Elige un color' : needsSize ? COPY.chooseSize : 'Elige una opción'} para agregarlo a tu bolsa.
            </p>
          )}
          {isFull && <p className="mt-3 text-xs text-flow-merlot">Tu bolsa llegó al máximo de 20 productos distintos.</p>}
          {added && <p className="mt-3 text-xs" role="status">Agregado a tu bolsa.</p>}

          {p.description && (
            <div className="mt-10">
              <h2 className="flow-label mb-3">Descripción</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed">{p.description}</p>
            </div>
          )}

          <div className="mt-10 border-t border-flow-stone">
            <details className="border-b border-flow-stone py-4">
              <summary className="flow-label cursor-pointer list-none">Envíos</summary>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-flow-muted">{policies.envios || POLICY_FALLBACK.envios}</p>
            </details>
            <details className="border-b border-flow-stone py-4">
              <summary className="flow-label cursor-pointer list-none">Cambios y devoluciones</summary>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-flow-muted">{policies.cambios || POLICY_FALLBACK.cambios}</p>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
