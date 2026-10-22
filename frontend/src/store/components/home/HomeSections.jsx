// Secciones de la Home. Todo el texto sale de flowContent; cada sección se oculta si no tiene datos.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { flowContent } from '../../content/flowContent';
import {
  productsInCapsule, capsuleColorOrder, dropColorOrder, productsInDrop, coverForColors, firstImage, colorsOfProduct, productType,
} from '../../lib/collections';
import { formatCOP, waLink } from '../../lib/format';
import { sizeGuide } from '../../lib/policies';
import { heroVideoOf } from '../../lib/heroVideo';
import HeroVideo from './HeroVideo';
import { useReveal } from '../../hooks/useReveal';
import ProductCard, { CAROUSEL_SIZES } from '../ProductCard';
import StoreImage from '../StoreImage';
import ProductCarousel from '../ProductCarousel';
import ColorSwatches from '../ColorSwatches';
import InstagramReels from './InstagramReels';

// Sombra de palma sutil (solo CSS, sin imágenes): hojas diagonales difuminadas sobre sand
const PALM_SHADOW = [
  'radial-gradient(120% 70% at 85% 10%, rgba(28,28,28,0.10), transparent 60%)',
  'repeating-linear-gradient(118deg, rgba(28,28,28,0.05) 0 2px, transparent 2px 46px)',
  'repeating-linear-gradient(62deg, rgba(28,28,28,0.035) 0 1px, transparent 1px 58px)',
  'radial-gradient(90% 60% at 10% 100%, rgba(160,148,134,0.35), transparent 70%)',
].join(',');

// Resalta en color stone la última aparición de `accent` dentro del texto
function Accented({ text, accent }) {
  if (!accent) return text;
  const i = text.lastIndexOf(accent);
  if (i === -1) return text;
  return <>{text.slice(0, i)}<span className="text-flow-stone">{accent}</span>{text.slice(i + accent.length)}</>;
}

export function Hero({ collection, path }) {
  const hero = collection?.hero;
  if (!hero) return null;
  // Video de fondo (hero.video) o foto: fondo oscuro con texto claro. Sin ninguno: composición sobre sand.
  const video = heroVideoOf(hero);
  const hasImage = !!hero.image || !!video;
  return (
    <section className={`flow-hero relative flex items-end md:items-center ${video ? 'overflow-hidden' : ''} ${hasImage ? 'text-flow-white flow-on-dark' : 'bg-flow-sand text-flow-black'}`}
      style={hasImage ? undefined : { backgroundImage: PALM_SHADOW }}>
      {video ? (
        <>
          <HeroVideo video={video} />
          {/* Legibilidad: abajo (texto en móvil) y a la izquierda (texto en escritorio), más un velo general */}
          <span className="absolute inset-0" aria-hidden="true"
            style={{ background: 'linear-gradient(to top, rgba(28,28,28,0.80), rgba(28,28,28,0.25) 55%, rgba(28,28,28,0.30)), linear-gradient(to right, rgba(28,28,28,0.45), rgba(28,28,28,0) 60%)' }} />
        </>
      ) : hasImage && (
        <>
          <img src={hero.image} alt="" className="absolute inset-0 h-full w-full object-cover" loading="eager" fetchpriority="high" />
          <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(28,28,28,0.70), rgba(28,28,28,0.15) 60%)' }} aria-hidden="true" />
        </>
      )}
      <div className="relative mx-auto w-full max-w-7xl px-5 pb-16 pt-32 md:px-8 md:pb-0 md:pt-24">
        <div className="relative isolate md:w-fit">
        {/* Con video: velo oscuro difuminado SOLO detrás del texto (contraste mínimo en todo el video: título ≥ 3:1,
            subtítulo y botones ≥ 4,5:1). Va encima del video y debajo del texto (isolate + -z-10). */}
        {video && (
          <span aria-hidden="true" className="pointer-events-none absolute -inset-x-16 -inset-y-20 -z-10"
            style={{ background: 'rgba(28,28,28,0.52)', filter: 'blur(40px)' }} />
        )}
        {collection.eyebrow && <p className="flow-label">{collection.eyebrow}</p>}
        <h1 className="flow-collection-name mt-5 text-[3.4rem] leading-[0.95] sm:text-7xl md:text-8xl lg:text-[8.5rem]">{hero.title}</h1>
        {hero.subtitle && <p className="mt-6 max-w-md text-base md:text-lg">{hero.subtitle}</p>}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          {hero.cta1 && <Link to={path(`/coleccion/${collection.slug}`)} className={`flow-btn ${hasImage ? 'flow-btn-light' : 'flow-btn-primary'}`}>{hero.cta1}</Link>}
          {hero.cta2 && <Link to={path('/colores')} className={`flow-btn flow-btn-outline ${hasImage ? 'flow-btn-outline-light' : ''}`}>{hero.cta2}</Link>}
        </div>
        {/* 80 % con el color (no con opacity: en Safari la opacidad recorta los rizos de la fuente) */}
        <p className="flow-script mt-10 text-3xl" style={{ color: hasImage ? 'rgba(255,255,255,0.8)' : 'rgba(28,28,28,0.8)' }}>{flowContent.brand.slogan}</p>
        </div>
      </div>
    </section>
  );
}

export function CurrentCollection({ collection, products, path, loading }) {
  const [tab, setTab] = useState('todo');
  if (!collection) return null;
  if (!loading && products.length === 0) return null;
  const capsule = collection.capsules?.find((c) => c.slug === tab) || null;
  const list = capsule ? productsInCapsule(products, collection, capsule) : products;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24" aria-labelledby="flow-coleccion">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="flow-coleccion" className="flow-collection-name text-4xl md:text-5xl">{collection.label}</h2>
          {collection.intro && <p className="mt-3 max-w-xl text-sm text-flow-muted md:text-base">{collection.intro}</p>}
        </div>
        <Link to={path(`/coleccion/${collection.slug}`)} className="flow-label hidden border-b border-flow-black pb-1 md:inline-block">Ver toda la colección</Link>
      </div>

      {(collection.capsules || []).length > 0 && (
        <div className="mt-8">
          <div className="flow-snap relative -mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 md:mx-0 md:scroll-px-0 md:px-0" role="tablist" aria-label="Cápsulas">
            {[{ slug: 'todo', name: 'Todo' }, ...collection.capsules].map((c) => (
              <button key={c.slug} type="button" role="tab" aria-selected={tab === c.slug} onClick={() => setTab(c.slug)}
                className={`flow-option flex-shrink-0 ${tab === c.slug ? 'is-active' : ''}`}>
                {c.slug !== 'todo' && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.palette?.bg }} aria-hidden="true" />}
                {c.slug === 'todo' ? 'Todo' : c.name.charAt(0) + c.name.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {capsule && (
            <p className="mt-4 flex items-center gap-3 text-sm">
              <span className="inline-block h-0.5 w-10" style={{ background: capsule.palette?.solid || 'var(--flow-stone)' }} aria-hidden="true" />
              <span className="flow-collection-name text-lg">{capsule.name}</span>
              <span className="text-flow-muted">{capsule.tagline}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-8">
        {loading ? (
          <div className="flex gap-4 overflow-hidden" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="flow-skeleton w-[72%] flex-shrink-0 sm:w-[44%] md:w-[31%] lg:w-[23.5%]" style={{ aspectRatio: '4 / 5' }} />)}
          </div>
        ) : list.length === 0 ? (
          <p className="py-10 text-sm text-flow-muted">Esta cápsula aún no tiene productos publicados.</p>
        ) : (
          <ProductCarousel label={capsule ? `Cápsula ${capsule.name}` : collection.label}>
            {list.slice(0, 12).map((p) => (
              <ProductCard key={`${tab}-${p.id}`} product={p} to={path(`/producto/${p.id}`)} isNew sizes={CAROUSEL_SIZES}
                colorKeys={capsule ? capsuleColorOrder(collection, capsule) : null} />
            ))}
          </ProductCarousel>
        )}
      </div>
      <div className="mt-8 md:hidden">
        <Link to={path(`/coleccion/${collection.slug}`)} className="flow-btn flow-btn-outline w-full">Ver toda la colección</Link>
      </div>
    </section>
  );
}

export function ShopByColor({ collection, products, path }) {
  const drops = (collection?.drops || [])
    .map((d) => ({ ...d, items: productsInDrop(products, d) }))
    .filter((d) => d.items.length > 0);
  if (drops.length === 0) return null;
  return (
    <section className="bg-flow-white py-16 md:py-24" aria-labelledby="flow-por-color">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <h2 id="flow-por-color" className="flow-serif text-2xl sm:text-3xl md:text-4xl">
            <Link to={path('/colores')} className="hover:underline">Comprar por color</Link>
          </h2>
          <Link to={path('/colores')} className="flow-label flex-shrink-0 border-b border-flow-black pb-1">Ver todos</Link>
        </div>
        <ProductCarousel label="Comprar por color" itemClass="w-[78%] sm:w-[46%] md:w-[31.5%]">
          {drops.map((d) => {
            const cover = coverForColors(d.items, dropColorOrder(d));
            return (
              <Link key={d.slug} to={path(`/colores/${d.slug}`)} className="group relative block overflow-hidden"
                style={{ aspectRatio: '4 / 5', background: d.palette?.bg, color: d.palette?.fg }}>
                {cover && <StoreImage src={cover} alt="" width="800" height="1000" sizes="(min-width: 768px) 32vw, (min-width: 640px) 46vw, 78vw" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />}
                {cover && <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(28,28,28,0.7), rgba(28,28,28,0) 55%)' }} aria-hidden="true" />}
                <span className={`absolute inset-x-0 bottom-0 p-6 ${cover ? 'text-flow-white' : ''}`}>
                  <span className="flow-collection-name block text-3xl md:text-4xl">{d.name}</span>
                  {d.description && <span className="mt-2 block text-sm opacity-90">{d.description}</span>}
                  <span className="flow-label mt-4 inline-block border-b border-current pb-1">Comprar</span>
                </span>
              </Link>
            );
          })}
        </ProductCarousel>
      </div>
    </section>
  );
}

// "Producto ícono": los puntos (solo colores con foto) cambian la foto principal y el color con el que abre la ficha.
export function Protagonist({ product, path }) {
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState('');
  if (!product) return null;
  const colors = colorsOfProduct(product).filter((c) => c.image);
  const shown = colors.find((c) => c.key === (preview || selected)) || null;
  const picked = colors.find((c) => c.key === selected) || null;
  const img = shown?.image || firstImage(product);
  const href = path(`/producto/${product.id}${picked ? `?color=${encodeURIComponent(picked.apiKey || picked.key)}` : ''}`);
  return (
    <section className="grid md:grid-cols-2" aria-labelledby="flow-protagonista">
      <div className="flow-photo md:aspect-auto md:min-h-[560px]">
        {img ? <StoreImage key={img} src={img} alt={shown ? `${product.name} en color ${shown.name}` : product.name} width="800" height="1000" sizes="(min-width: 768px) 50vw, 100vw" />
          : <span className="absolute inset-0 bg-flow-sand" aria-hidden="true" />}
      </div>
      <div className="flex flex-col justify-center bg-flow-sand px-6 py-14 md:px-16">
        <p className="flow-label">Producto ícono</p>
        <h2 id="flow-protagonista" className="flow-serif mt-4 text-4xl md:text-5xl">{product.name}</h2>
        <p className="mt-3 text-lg">{formatCOP(product.price)}</p>
        <ColorSwatches colors={colors} selected={selected} onSelect={setSelected} onPreview={setPreview}
          label={`Colores de ${product.name}`} max={8} className="mt-4" />
        <div className="mt-8">
          <Link to={href} className="flow-btn flow-btn-primary">Ver producto{picked ? <span className="flow-sr-only"> en color {picked.name}</span> : null}</Link>
        </div>
      </div>
    </section>
  );
}

function StoryBlock({ block }) {
  const [ref, visible] = useReveal();
  return (
    <div ref={ref} className={`flow-reveal ${visible ? 'is-visible' : ''} ${block.quote ? 'py-6' : ''}`}>
      {block.lines.map((line, i) => (
        <p key={i} className={block.quote
          ? 'flow-serif text-3xl leading-snug md:text-5xl'
          : i === 0 ? 'flow-serif text-2xl leading-snug md:text-4xl' : 'mt-4 text-base leading-relaxed opacity-80 md:text-lg'}>
          <Accented text={line} accent={i === block.lines.length - 1 ? block.accent : null} />
        </p>
      ))}
      {block.list?.length > 0 && (
        <ul className="mt-6 space-y-2 border-l border-flow-stone pl-5">
          {block.list.map((item) => <li key={item} className="flow-label">{item}</li>)}
        </ul>
      )}
    </div>
  );
}

export function Storytelling({ collection }) {
  const blocks = (collection?.storytelling || []).filter((b) => b && Array.isArray(b.lines) && b.lines.length);
  if (blocks.length === 0) return null;
  return (
    <section className="bg-flow-black text-flow-white flow-on-dark" aria-label={`Historia de ${collection.name}`}>
      <div className="mx-auto max-w-3xl space-y-16 px-6 py-20 md:space-y-24 md:py-32">
        <p className="flow-collection-name text-flow-stone text-xl">{collection.name}</p>
        {blocks.map((b, i) => <StoryBlock key={i} block={b} />)}
      </div>
    </section>
  );
}

export function Capsules({ collection, path }) {
  const capsules = collection?.capsules || [];
  if (capsules.length === 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24" aria-labelledby="flow-capsulas">
      <h2 id="flow-capsulas" className="flow-label mb-8 text-center">Cápsulas {collection.name}</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        {capsules.map((c) => (
          <Link key={c.slug} to={`${path(`/coleccion/${collection.slug}`)}?capsula=${c.slug}`}
            className="flex min-h-[300px] min-w-0 flex-col justify-end break-words p-8 transition-opacity hover:opacity-95 lg:min-h-[380px]"
            style={{ background: `linear-gradient(to top, rgba(28,28,28,0.55), rgba(28,28,28,0) 70%), ${c.palette?.bg || "var(--flow-black)"}`, color: c.palette?.fg }}>
            <span className="flow-label opacity-90">{c.tagline}</span>
            <span className="flow-collection-name mt-3 text-5xl lg:text-[2.6rem] xl:text-5xl">{c.name}</span>
            {c.text?.[0] && <span className="mt-4 text-sm leading-relaxed opacity-90">{c.text[0]}</span>}
            <span className="flow-label mt-6 inline-block self-start border-b border-current pb-1">Ver cápsula</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const CATEGORY_TONES = ['#D9CFC3', '#19212C', '#A09486', '#5C1923'];

export function PopularCategories({ categories, products }) {
  const list = categories.slice(0, 8);
  if (list.length === 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pb-16 md:px-8 md:pb-24" aria-labelledby="flow-categorias">
      <h2 id="flow-categorias" className="flow-serif mb-8 text-3xl md:text-4xl">Lo más popular</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {list.map((c, i) => {
          const cover = firstImage(products.find((p) => productType(p) === c.name && firstImage(p)));
          const tone = CATEGORY_TONES[i % CATEGORY_TONES.length];
          const dark = tone !== '#D9CFC3' && tone !== '#A09486';
          return (
            <Link key={c.name} to={c.href} className="group relative block overflow-hidden" style={{ aspectRatio: '4 / 5', background: tone }}>
              {cover && <StoreImage src={cover} alt="" width="800" height="1000" sizes="(min-width: 768px) 25vw, 50vw" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />}
              <span className="absolute inset-0" style={{ background: cover ? 'linear-gradient(to top, rgba(28,28,28,0.6), rgba(28,28,28,0) 55%)' : 'none' }} aria-hidden="true" />
              <span className={`absolute bottom-4 left-4 right-4 ${cover || dark ? 'text-flow-white' : 'text-flow-black'}`}>
                <span className="flow-serif block text-xl md:text-2xl">{c.name}</span>
                <span className="flow-label mt-1 block opacity-90">{c.count} {Number(c.count) === 1 ? 'producto' : 'productos'}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function ValuesStrip({ values }) {
  if (!values?.length) return null;
  return (
    <section className="border-y border-flow-stone" aria-label="Valores">
      <ul className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-4 py-8 md:gap-x-8">
        {values.map((v, i) => (
          <li key={v} className="flow-label flex items-center gap-8">
            {i > 0 && <span className="hidden h-1 w-1 rounded-full bg-flow-stone md:inline-block" aria-hidden="true" />}
            {v}
          </li>
        ))}
      </ul>
    </section>
  );
}

// FLOW ARCHIVE: título, texto, enlace y el catálogo del archivo en carrusel. Sin productos no se muestra (como antes).
export function ArchiveBanner({ category, products = [], path }) {
  if (!category || products.length === 0) return null;
  const a = flowContent.archive;
  const cta = a.cta || 'Ver archivo';
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 md:px-8" aria-labelledby="flow-archive">
      <div className="border border-flow-stone p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 id="flow-archive" className="flow-collection-name text-3xl">{a.title}</h2>
            <p className="mt-2 text-sm text-flow-muted">{a.text}</p>
          </div>
          <Link to={category.href} className="flow-label self-start border-b border-flow-black pb-1 md:self-end">{cta}</Link>
        </div>
        <div className="mt-8">
          <ProductCarousel label={a.title}>
            {products.map((p) => <ProductCard key={p.id} product={p} to={path(`/producto/${p.id}`)} sizes={CAROUSEL_SIZES} />)}
          </ProductCarousel>
        </div>
      </div>
    </section>
  );
}

export function FirstTime({ path }) {
  const steps = flowContent.firstTime || [];
  if (steps.length === 0) return null;
  return (
    <section className="bg-flow-sand" aria-labelledby="flow-primera-vez">
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-20">
        <h2 id="flow-primera-vez" className="flow-serif text-3xl md:text-4xl">¿Primera vez en FLOW?</h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s} className="border-t border-flow-black pt-5">
              <span className="flow-label">Paso {i + 1}</span>
              <p className="mt-3 text-base">{s}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-6">
          {sizeGuide() && <Link to={path('/guia-de-tallas')} className="flow-label border-b border-flow-black pb-1">{sizeGuide().title}</Link>}
          <Link to={path('/ayuda')} className="flow-label border-b border-flow-black pb-1">Ayuda</Link>
        </div>
      </div>
    </section>
  );
}

// Banda Flow Club: título, frase, botones (WhatsApp si hay número, la cuenta de Instagram) y los reels.
export function FlowClub({ store }) {
  const club = flowContent.club;
  const insta = flowContent.instagram;
  const wa = waLink(store?.whatsapp_number, club?.whatsappMessage);
  const ig = insta?.url || store?.social?.instagram || flowContent.brand.instagram;
  const hasReels = (insta?.reels || []).length > 0;
  if (!club || (!wa && !ig && !hasReels)) return null;
  return (
    <section className="bg-flow-navy text-flow-white flow-on-dark" aria-labelledby="flow-club">
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 id="flow-club" className="flow-collection-name text-3xl md:text-4xl">{club.title}</h2>
            <p className="mt-2 text-sm text-flow-sand md:text-base">{club.text}</p>
          </div>
          {(wa || ig) && (
            <div className="flex flex-col gap-3 sm:flex-row">
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-light">
                  <MessageCircle size={16} strokeWidth={1.5} aria-hidden="true" /> Unirme por WhatsApp
                </a>
              )}
              {ig && <a href={ig} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-outline flow-btn-outline-light">{insta?.handle || 'Instagram'}</a>}
            </div>
          )}
        </div>
        {hasReels && <div className="mt-10"><InstagramReels onDark /></div>}
      </div>
    </section>
  );
}

export function SloganBand() {
  return (
    <section className="bg-flow-white">
      <div className="mx-auto max-w-7xl px-6 py-20 text-center">
        <p className="flow-script text-4xl sm:text-5xl md:text-7xl">{flowContent.brand.slogan}</p>
      </div>
    </section>
  );
}
