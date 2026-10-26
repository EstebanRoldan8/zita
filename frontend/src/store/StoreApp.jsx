// Tienda pública de Flow. Se monta en /tienda/:slug/* (o en la raíz con dominio propio),
// fuera de ProtectedRoute, del Layout del panel y del Sidebar.
import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import './flow.css';
import { storeApi } from './lib/storeApi';
import { loadFlowFonts } from './lib/fonts';
import { StoreContext } from './hooks/useStore';
import CartProvider from './components/CartProvider';
import StoreLayout from './components/StoreLayout';
import StoreErrorBoundary from './components/StoreErrorBoundary';
import { StoreUnavailable, ErrorState, PageNotFound } from './components/States';

const Home = lazy(() => import('./pages/Home'));
const Collection = lazy(() => import('./pages/Collection'));
const ProductPage = lazy(() => import('./pages/ProductPage'));
const BagPage = lazy(() => import('./pages/BagPage'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Confirmation = lazy(() => import('./pages/Confirmation'));
const CollectionDetail = lazy(() => import('./pages/CollectionDetail'));
const ColorsIndex = lazy(() => import('./pages/Colors').then((m) => ({ default: m.ColorsIndex })));
const DropPage = lazy(() => import('./pages/Colors').then((m) => ({ default: m.DropPage })));
const Help = lazy(() => import('./pages/Help'));
const SizeGuide = lazy(() => import('./pages/SizeGuide'));
const SobreFlow = lazy(() => import('./pages/SobreFlow'));
const Policy = lazy(() => import('./pages/Policy'));
const FormsIndex = lazy(() => import('./pages/LegalForms').then((m) => ({ default: m.FormsIndex })));
const FormPage = lazy(() => import('./pages/LegalForms').then((m) => ({ default: m.FormPage })));

// Mientras llega el código de la página: reserva el alto de la pantalla para que el footer no se asome y
// luego salte cuando se pinta el contenido (era casi todo el CLS de la portada).
function PageFallback() {
  return <div className="mx-auto min-h-[100svh] max-w-7xl px-4 py-16 md:px-8"><div className="flow-skeleton h-8 w-1/3" /></div>;
}

// slugOverride: slug fijo para dominio propio (VITE_STORE_HOST_SLUG); base '' en ese caso
export default function StoreApp({ slugOverride }) {
  const params = useParams();
  const slug = String(slugOverride || params.slug || '').toLowerCase();
  const base = slugOverride ? '' : `/tienda/${slug}`;

  useEffect(() => { loadFlowFonts(); }, []);

  const { data: store, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['store', slug, 'info'],
    queryFn: () => storeApi.getStore(slug),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => err?.response?.status !== 404 && count < 2,
  });

  if (!slug || error?.response?.status === 404) return <StoreUnavailable />;
  if (isLoading) {
    return (
      <div className="flow-store" aria-busy="true">
        <div className="h-16 border-b border-flow-stone" />
        <div className="flow-skeleton mx-auto mt-0 h-[60vh] w-full" />
      </div>
    );
  }
  if (isError || !store || typeof store !== 'object') {
    return <div className="flow-store"><ErrorState message="No pudimos cargar la tienda." onRetry={refetch} /></div>;
  }

  return (
    <StoreContext.Provider value={{ slug, base, store }}>
      <StoreErrorBoundary slug={slug} fullScreen>
      <CartProvider slug={slug}>
        <Routes>
          <Route element={<StoreLayout />}>
            <Route index element={<Suspense fallback={<PageFallback />}><Home /></Suspense>} />
            <Route path="coleccion" element={<Suspense fallback={<PageFallback />}><Collection /></Suspense>} />
            <Route path="producto/:id" element={<Suspense fallback={<PageFallback />}><ProductPage /></Suspense>} />
            <Route path="bolsa" element={<Suspense fallback={<PageFallback />}><BagPage /></Suspense>} />
            <Route path="checkout" element={<Suspense fallback={<PageFallback />}><Checkout /></Suspense>} />
            <Route path="pedido/:orderId" element={<Suspense fallback={<PageFallback />}><Confirmation /></Suspense>} />
            <Route path="coleccion/:collectionSlug" element={<Suspense fallback={<PageFallback />}><CollectionDetail /></Suspense>} />
            <Route path="productos" element={<Navigate to="../coleccion" replace />} />
            <Route path="colores" element={<Suspense fallback={<PageFallback />}><ColorsIndex /></Suspense>} />
            <Route path="colores/:dropSlug" element={<Suspense fallback={<PageFallback />}><DropPage /></Suspense>} />
            <Route path="ayuda" element={<Suspense fallback={<PageFallback />}><Help /></Suspense>} />
            <Route path="guia-de-tallas" element={<Suspense fallback={<PageFallback />}><SizeGuide /></Suspense>} />
            <Route path="sobre-flow" element={<Suspense fallback={<PageFallback />}><SobreFlow /></Suspense>} />
            <Route path="nosotros" element={<Navigate to="../sobre-flow" replace />} />
            <Route path="terminos" element={<Suspense fallback={<PageFallback />}><Policy kind="terminos" /></Suspense>} />
            <Route path="envios" element={<Suspense fallback={<PageFallback />}><Policy kind="envios" /></Suspense>} />
            <Route path="cambios" element={<Suspense fallback={<PageFallback />}><Policy kind="cambios" /></Suspense>} />
            <Route path="privacidad" element={<Suspense fallback={<PageFallback />}><Policy kind="privacidad" /></Suspense>} />
            <Route path="preguntas-frecuentes" element={<Suspense fallback={<PageFallback />}><Policy kind="preguntas-frecuentes" /></Suspense>} />
            <Route path="promociones" element={<Suspense fallback={<PageFallback />}><Policy kind="promociones" /></Suspense>} />
            <Route path="formatos" element={<Suspense fallback={<PageFallback />}><FormsIndex /></Suspense>} />
            <Route path="formatos/:formKind" element={<Suspense fallback={<PageFallback />}><FormPage /></Suspense>} />
            <Route path="*" element={<PageNotFound homePath={base || '/'} />} />
          </Route>
        </Routes>
      </CartProvider>
      </StoreErrorBoundary>
    </StoreContext.Provider>
  );
}
