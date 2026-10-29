import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Minus, Plus, X } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { productSeo, notFoundSeo } from '../lib/seo';
import { storeApi } from '../lib/storeApi';
import { formatCOP, attrValue, optionKey, COLOR_KEYS, SIZE_KEYS } from '../lib/format';
import { COPY } from '../lib/copy';
import { POLICIES, sizeGuide, sizeGuideTablesFor } from '../lib/policies';
import { NEUTRAL_COLOR } from '../content/flowContent';
import { normalize, getActiveCollection, productsInCollection, colorHex, isLightColor, productType, typePath, garmentTypesOf } from '../lib/collections';
import { useCatalog } from '../hooks/useCatalog';
import ProductCard, { CAROUSEL_SIZES } from '../components/ProductCard';
import StoreImage from '../components/StoreImage';
import ProductCarousel from '../components/ProductCarousel';
import SizeGuideTable from '../components/SizeGuideTable';
import { parseSpecs } from '../lib/specs';
import { asArray, asObject, asUrls } from '../lib/safe';
import { assertProduct } from '../lib/bagRules';
import { promoGroup } from '../lib/setPromo';
import { ErrorState, PageNotFound } from '../components/States';

const SIZE_ORDER = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];
const sizeRank = (s) => {
  const i = SIZE_ORDER.indexOf(String(s).toLowerCase());
  return i === -1 ? 100 + (Number(s) || 0) : i;
};
const variantText = (attributes) => Object.values(attributes || {}).join(' / ');
// Miniaturas de 64 px: la versión de 400 cubre hasta DPR 3
const THUMB_WIDTHS = [400];

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
    // min-w-0: celda de la grilla; sin esto, con muchas miniaturas la fila ensancha la galería y hay scroll horizontal
    <div className="min-w-0">
      {/* Swipe en móvil (scroll-snap); en desktop se navega con las miniaturas */}
      <div ref={scroller} className="flow-snap flex overflow-x-auto"
        onScroll={(e) => { const el = e.currentTarget; setActive(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))); }}
        aria-label={`Fotos de ${name}`}>
        {images.map((src, i) => (
          <div key={src} className="flow-photo w-full flex-shrink-0">
            <StoreImage src={src} alt={`${name}, foto ${i + 1} de ${images.length}`} width="800" height="1000"
              sizes="(min-width: 768px) 50vw, 100vw" loading={i === 0 ? 'eager' : 'lazy'} fetchPriority={i === 0 ? 'high' : undefined} />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Miniaturas">
          {images.map((src, i) => (
            <button key={src} type="button" role="tab" aria-selected={i === active} aria-label={`Ver foto ${i + 1}`}
              onClick={() => goTo(i)}
              className={`flow-photo w-16 flex-shrink-0 border ${i === active ? 'border-flow-black' : 'border-transparent'}`}>
              <StoreImage src={src} alt="" width="64" height="80" widths={THUMB_WIDTHS} baseWidth={400} sizes="64px" />
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
  const [searchParams] = useSearchParams();
  const colorParam = normalize(searchParams.get('color'));
  const catalog = useCatalog();
  const [guideOpen, setGuideOpen] = useState(false);

  const { data: p, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['store', slug, 'product', id],
    queryFn: async () => assertProduct(await storeApi.getProduct(slug, id)),
    retry: (count, err) => err?.response?.status !== 404 && count < 2,
  });

  // Lo que eligió la persona; los valores efectivos (colorKey, size, qty) se derivan abajo
  const [pickedColor, setColorKey] = useState('');
  const [pickedSize, setSize] = useState('');
  const [optionId, setOptionId] = useState(''); // variantes sin color ni talla
  const [pickedQty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const seoCtx = useSeoContext();
  const notFound = error?.response?.status === 404 || !!error?.notAvailable;
  useSeo(notFound ? notFoundSeo() : p ? productSeo(seoCtx, { product: p, store, colorParam: searchParams.get('color') }) : null);

  // Variantes con su color (clave normalizada) y talla
  const variants = useMemo(() => asArray(p?.variants).filter((v) => v && v.id).map((v) => {
    const colorName = attrValue(v.attributes, COLOR_KEYS);
    return { ...v, colorKey: colorName ? optionKey(colorName) : '', colorName, size: attrValue(v.attributes, SIZE_KEYS) };
  }), [p]);
  const hasVariants = variants.length > 0;
  const colors = useMemo(() => asArray(p?.colors).filter((c) => c && c.key).map((c) => ({ ...c, name: String(c.name ?? c.key) })), [p]);
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
  const fromUrl = colorParam ? colors.find((c) => normalize(c.key) === colorParam || normalize(c.name) === colorParam)?.key : '';
  const colorKey = pickedColor || fromUrl || (hasColor && availableColors.length === 1 ? availableColors[0].key : '');

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
    const byColor = colorKey ? asUrls(asObject(p.images_by_color)[colorKey]) : [];
    return byColor.length > 0 ? byColor : asUrls(p.images);
  }, [p, colorKey]);

  // Completa tu look: otros productos de la colección activa (sin el actual)
  const related = useMemo(() => productsInCollection(catalog.data || [], getActiveCollection())
    .filter((x) => x.id !== id).slice(0, 8), [catalog.data, id]);

  // Avisa al botón flotante de WhatsApp que en móvil hay un botón fijo abajo
  useEffect(() => {
    document.body.dataset.flowStickyCta = '1';
    return () => { delete document.body.dataset.flowStickyCta; };
  }, []);
  // Nombre del producto para el mensaje del botón flotante de WhatsApp
  useEffect(() => {
    if (!p?.name) return undefined;
    document.body.dataset.flowProduct = String(p.name);
    return () => { delete document.body.dataset.flowProduct; };
  }, [p?.name]);

  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 md:grid-cols-2 md:px-8" aria-busy="true">
        <div className="flow-skeleton" style={{ aspectRatio: '4 / 5' }} />
        <div><div className="flow-skeleton h-8 w-2/3" /><div className="flow-skeleton mt-4 h-5 w-1/4" /></div>
      </div>
    );
  }
  if (notFound) return <PageNotFound homePath={path('/coleccion')} />;
  if (isError || !p) return <ErrorState message="No pudimos cargar este producto." onRetry={refetch} />;

  const needsColor = hasColor && !colorKey;
  const needsSize = hasSize && !size;
  const needsOption = genericOptions && !optionId;
  const soldOut = hasVariants ? !variants.some((v) => v.available) : !p.in_stock;
  const canAdd = !soldOut && !needsColor && !needsSize && !needsOption && maxQty > 0 && !isFull && (!hasVariants || !!selected?.available);
  const colorName = colors.find((c) => c.key === colorKey)?.name || selected?.colorName || '';

  // Set: qué incluye (de la API pública, sin ids ni costos)
  const bundleParts = Array.isArray(p.bundle?.components) ? p.bundle.components : [];
  const includes = bundleParts.length
    ? bundleParts.map((c) => `${Number(c.quantity) > 1 ? `${c.quantity} × ` : ''}${c.name}`).join(' + ')
    : null;

  const handleAdd = () => {
    if (!canAdd) return;
    add({
      product_id: p.id,
      variant_id: selected?.id || null,
      name: p.name,
      price: p.price,
      image: gallery[0] || asUrls(p.images)[0] || null,
      color: colorName || null,
      size: selected?.size || (genericOptions ? variantText(selected?.attributes) : null),
      quantity: qty,
      max_qty: maxQty,
      includes,
      group: promoGroup(p),
    });
    setAdded(true);
    setOpen(true);
  };

  // Guía de tallas: solo las tablas del tipo de prenda del producto (o de los componentes de un set)
  const guideTables = sizeGuideTablesFor(garmentTypesOf(p));
  const guide = guideTables.length ? sizeGuide() : null;
  const { specs, rest: specRest } = parseSpecs(p.description);

  return (
    <div className="flow-product-page mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <nav className="flow-label mb-6 text-flow-muted" aria-label="Ruta">
        <Link to={path('/coleccion')} className="hover:underline">Tienda</Link>
        {productType(p) && <> <span aria-hidden="true">/</span> <Link to={path(typePath(productType(p)))} className="hover:underline">{productType(p)}</Link></>}
      </nav>

      <div className="grid gap-10 md:grid-cols-2 md:gap-16">
        <Gallery key={gallery.join('|')} images={gallery} name={colorName ? `${p.name} en color ${colorName}` : p.name} />

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
                {colors.map((c) => {
                  const hex = colorHex(c.name) || colorHex(c.key);
                  return (
                    <label key={c.key} title={c.name}
                      className={`flow-swatch-round ${c.available ? '' : 'is-unavailable'} ${colorKey === c.key ? 'is-selected' : ''}`}>
                      <input type="radio" name="flow-color" value={c.key} checked={colorKey === c.key}
                        onChange={() => setColorKey(c.key)} aria-label={`${c.name}${c.available ? '' : ' (agotado)'}`} />
                      <span className="flow-swatch-fill" aria-hidden="true"
                        style={{ background: hex || NEUTRAL_COLOR, borderColor: hex && !isLightColor(hex) ? 'transparent' : 'var(--flow-stone)' }} />
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {hasSize && (
            <fieldset className="relative mb-8">
              <legend className="flow-label mb-3">{COPY.chooseSize}</legend>
              {guide && (
                <button type="button" onClick={() => setGuideOpen(true)} aria-haspopup="dialog"
                  className="flow-label absolute right-0 top-0 border-b border-flow-black pb-0.5">
                  {guide.title}
                </button>
              )}
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

          {/* En móvil queda fijo abajo; en desktop vuelve a su lugar */}
          <div className="flow-sticky-cta">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 text-sm md:hidden">{formatCOP(p.price)}</span>
              <button type="button" onClick={handleAdd} disabled={!canAdd} className="flow-btn flow-btn-primary w-full">
                {soldOut ? COPY.soldOut : COPY.addToBag}
              </button>
            </div>
          </div>
          {!soldOut && (needsColor || needsSize || needsOption) && (
            <p className="mt-3 text-xs text-flow-muted">
              {needsColor ? 'Elige un color' : needsSize ? COPY.chooseSize : 'Elige una opción'} para agregarlo a tu bolsa.
            </p>
          )}
          {isFull && <p className="mt-3 text-xs text-flow-merlot">Tu bolsa llegó al máximo de 20 productos distintos.</p>}
          {added && <p className="mt-3 text-xs" role="status">Agregado a tu bolsa.</p>}

          {bundleParts.length > 0 && (
            <div className="mt-10">
              <h2 className="flow-label mb-3">Incluye</h2>
              <ul className="space-y-1 text-sm">
                {bundleParts.map((c) => (
                  <li key={c.name}>{Number(c.quantity) > 1 ? `${c.quantity} × ` : ''}{c.name}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-flow-muted">Todas las piezas en la talla y el color que elijas.</p>
            </div>
          )}

          {(specs.length > 0 || specRest) && (
            <div className="mt-10">
              <h2 className="flow-label mb-3">Descripción</h2>
              {specRest && <p className="whitespace-pre-line text-sm leading-relaxed">{specRest}</p>}
              {specs.length > 0 && (
                <dl className="mt-4 divide-y divide-[color:var(--flow-sand)] border-y border-[color:var(--flow-sand)] text-sm">
                  {specs.map((sp) => (
                    <div key={sp.label} className="grid grid-cols-[7rem_1fr] gap-3 py-3">
                      <dt className="flow-label text-flow-muted">{sp.label}</dt>
                      <dd>{sp.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

          {/* Envíos y cambios: enlaces a las políticas publicadas (el texto vigente vive en una sola página) */}
          <div className="mt-10 border-t border-flow-stone">
            {['envios', 'cambios'].map((k) => (
              <Link key={k} to={path(`/${k}`)} className="flow-label flex min-h-14 items-center justify-between gap-4 border-b border-flow-stone py-2">
                {POLICIES[k].label} <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-20" aria-labelledby="flow-look">
          <h2 id="flow-look" className="flow-serif mb-8 text-2xl md:text-3xl">Completa tu look</h2>
          <ProductCarousel label="Completa tu look">
            {related.map((r) => <ProductCard key={r.id} product={r} to={path(`/producto/${r.id}`)} isNew sizes={CAROUSEL_SIZES} />)}
          </ProductCarousel>
        </section>
      )}

      {guide && guideOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Guía de tallas"
          onKeyDown={(e) => { if (e.key === 'Escape') setGuideOpen(false); }}>
          <div className="absolute inset-0" style={{ background: 'rgba(28,28,28,0.4)' }} onClick={() => setGuideOpen(false)} />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto bg-flow-white p-6 md:p-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flow-label">{guide.title}</h2>
              <button type="button" onClick={() => setGuideOpen(false)} aria-label="Cerrar guía de tallas" autoFocus
                className="flex h-11 w-11 items-center justify-center">
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>
            <div className="space-y-8">
              {guideTables.map((t) => <SizeGuideTable key={t.title} table={t} headingLevel={3} />)}
            </div>
            {guide.note && <p className="mt-6 text-sm text-flow-muted">{guide.note}</p>}
            <Link to={path('/guia-de-tallas')} className="flow-label mt-6 inline-block border-b border-flow-black pb-1">Ver guía completa</Link>
          </div>
        </div>
      )}
    </div>
  );
}
