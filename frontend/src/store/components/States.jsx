import { Link } from 'react-router-dom';
import { COPY } from '../lib/copy';
import { useSeo } from '../hooks/useSeo';
import { notFoundSeo } from '../lib/seo';

export function ErrorState({ message = 'No pudimos cargar esta sección.', onRetry }) {
  return (
    <div className="py-16 text-center" role="alert">
      <p className="text-sm text-flow-muted mb-6">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="flow-btn flow-btn-outline">Reintentar</button>}
    </div>
  );
}

export function StoreUnavailable() {
  useSeo(notFoundSeo());
  return (
    <div className="flow-store flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <p className="flow-label text-flow-muted mb-4">404</p>
        <h1 className="flow-serif text-3xl mb-4">{COPY.storeUnavailable}</h1>
        <p className="text-sm text-flow-muted">Revisa el enlace o vuelve más tarde.</p>
      </div>
    </div>
  );
}

// Cualquier 404 de la tienda queda en noindex
export function PageNotFound({ homePath }) {
  useSeo(notFoundSeo());
  return (
    <div className="py-24 text-center px-6">
      <p className="flow-label text-flow-muted mb-4">404</p>
      <h1 className="flow-serif text-3xl mb-6">Esta página no existe</h1>
      <Link to={homePath} className="flow-btn flow-btn-primary">Volver al inicio</Link>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="flow-skeleton" style={{ aspectRatio: '4 / 5' }} />
          <div className="flow-skeleton mt-4 h-3 w-3/4" />
          <div className="flow-skeleton mt-2 h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
