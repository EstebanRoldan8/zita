import { Link } from 'react-router-dom';
import { useStore, useStorePath } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { COPY } from '../lib/copy';

export default function About() {
  const { store } = useStore();
  const path = useStorePath();
  useDocumentMeta(`Nosotros — ${store.name || 'Flow'}`, COPY.aboutLead);

  return (
    <>
      <section className="mx-auto max-w-3xl px-4 py-20 text-center md:px-8">
        <p className="flow-label text-flow-muted">Nosotros</p>
        <h1 className="flow-serif mt-6 text-3xl leading-snug md:text-5xl">{COPY.aboutLead}</h1>
        <p className="mx-auto mt-8 max-w-xl text-sm leading-relaxed text-flow-muted md:text-base">{COPY.aboutBody}</p>
      </section>

      {/* TODO: fotos lifestyle (movimiento, luz natural, fondo limpio). Hoy: bloques planos de la paleta. */}
      <section className="mx-auto grid max-w-7xl gap-3 px-4 md:grid-cols-2 md:px-8" data-placeholder="lifestyle-fotos">
        <div className="bg-flow-sand flex items-end p-8" style={{ aspectRatio: '4 / 5' }}>
          <p className="flow-label">Foto lifestyle pendiente</p>
        </div>
        <div className="grid gap-3">
          <div className="bg-flow-stone flex items-end p-8 text-flow-black" style={{ minHeight: 240 }}>
            <p className="flow-display text-2xl">Fuerza</p>
          </div>
          <div className="bg-flow-navy flex items-end p-8 text-flow-white" style={{ minHeight: 240 }}>
            <p className="flow-display text-2xl">Movimiento con intención</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <h2 className="flow-label mb-12 text-center">Nuestros valores</h2>
        <div className="grid gap-12 md:grid-cols-3">
          {COPY.values.map((v) => (
            <div key={v.title} className="border-t border-flow-stone pt-6">
              <h3 className="flow-serif text-xl">{v.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-flow-muted">{v.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-16 text-center">
          <Link to={path('/coleccion')} className="flow-btn flow-btn-primary">{COPY.heroCta}</Link>
        </div>
      </section>
    </>
  );
}
