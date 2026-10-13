import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useStore, useStorePath } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { storeApi } from '../lib/storeApi';
import { COPY } from '../lib/copy';
import ProductCard from '../components/ProductCard';
import { ProductGridSkeleton, ErrorState } from '../components/States';

// Combinaciones aprobadas para bloques de color (texto en Soft Black sobre stone/rocío/lavender)
const COLOR_BLOCKS = [
  'bg-flow-navy text-flow-white',
  'bg-flow-sand text-flow-merlot',
  'bg-flow-black text-flow-lavender',
  'bg-flow-stone text-flow-black',
];

export default function Home() {
  const { slug, store } = useStore();
  const path = useStorePath();
  useDocumentMeta(`${store.name || 'Flow'} — ${COPY.slogan}`, store.tagline || COPY.essence);

  const categories = useQuery({
    queryKey: ['store', slug, 'categories'],
    queryFn: () => storeApi.getCategories(slug),
    staleTime: 5 * 60 * 1000,
  });
  const latest = useQuery({
    queryKey: ['store', slug, 'products', 'latest'],
    queryFn: () => storeApi.getProducts(slug, { limit: 8 }),
    staleTime: 60 * 1000,
  });

  const cats = (categories.data?.categories || []).slice(0, 4);

  return (
    <>
      {/* Hero. TODO: foto lifestyle del hero (luz natural, fondo limpio). Hoy: bloque sand plano. */}
      <section className="bg-flow-sand" data-placeholder="hero-foto">
        <div className="mx-auto flex min-h-[70vh] max-w-7xl flex-col items-center justify-center px-6 py-24 text-center">
          <h1 className="flow-display text-4xl sm:text-5xl md:text-7xl" style={{ letterSpacing: '0.18em' }}>{COPY.heroTitle}</h1>
          <p className="mt-6 max-w-md text-sm sm:text-base">{COPY.heroSubtitle}</p>
          <Link to={path('/coleccion')} className="flow-btn flow-btn-primary mt-10">{COPY.heroCta}</Link>
        </div>
      </section>

      {/* Categorías en bloques de color planos */}
      {cats.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 md:px-8" aria-labelledby="flow-categorias">
          <h2 id="flow-categorias" className="flow-label mb-8 text-center">Categorías</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cats.map((c, i) => (
              <Link key={c.name} to={`${path('/coleccion')}?categoria=${encodeURIComponent(c.name)}`}
                className={`flex aspect-square flex-col items-center justify-center p-4 text-center ${COLOR_BLOCKS[i % COLOR_BLOCKS.length]}`}>
                <span className="flow-serif text-xl md:text-2xl">{c.name}</span>
                <span className="flow-label mt-2 opacity-80">{c.count} {c.count === 1 ? 'producto' : 'productos'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Lo nuevo */}
      <section className="mx-auto max-w-7xl px-4 pb-20 md:px-8" aria-labelledby="flow-nuevo">
        <div className="mb-8 flex items-end justify-between">
          <h2 id="flow-nuevo" className="flow-serif text-2xl md:text-3xl">Lo nuevo</h2>
          <Link to={path('/coleccion')} className="flow-label border-b border-flow-black pb-1">Ver todo</Link>
        </div>
        {latest.isLoading ? (
          <ProductGridSkeleton count={8} />
        ) : latest.isError ? (
          <ErrorState message="No pudimos cargar los productos." onRetry={latest.refetch} />
        ) : (latest.data?.products || []).length === 0 ? (
          <p className="py-16 text-center text-sm text-flow-muted">Muy pronto tendremos productos para ti.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {latest.data.products.map((p) => <ProductCard key={p.id} product={p} to={path(`/producto/${p.id}`)} />)}
          </div>
        )}
      </section>

      <hr className="flow-rule mx-auto max-w-7xl" />

      {/* Marca: movimiento, autenticidad, minimalismo */}
      <section className="mx-auto max-w-7xl px-4 py-20 md:px-8" aria-labelledby="flow-marca">
        <h2 id="flow-marca" className="flow-serif mx-auto max-w-2xl text-center text-2xl md:text-3xl">{COPY.essence}</h2>
        <div className="mt-14 grid gap-10 md:grid-cols-3">
          {COPY.values.map((v) => (
            <div key={v.title} className="text-center">
              <h3 className="flow-label mb-3">{v.title}</h3>
              <p className="text-sm leading-relaxed text-flow-muted">{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Slogan */}
      <section className="bg-flow-sand">
        <div className="mx-auto max-w-7xl px-6 py-20 text-center">
          <p className="flow-script text-5xl md:text-7xl">{COPY.slogan}</p>
        </div>
      </section>
    </>
  );
}
