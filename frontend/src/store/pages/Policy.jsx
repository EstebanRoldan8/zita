import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { LEGAL_DOCS } from '../content/flowLegal';
import { POLICIES, FORMS } from '../lib/policies';
import { legalEffective } from '../lib/legal';
import { policySeo } from '../lib/seo';
import { LegalBlocks, LegalInline } from '../components/LegalText';
import PqrBlock from '../components/PqrBlock';
import { PageNotFound } from '../components/States';

// Enlaces a los formatos imprimibles (sección "Cómo hacer tus solicitudes" de Cambios)
function FormsBox() {
  const path = useStorePath();
  return (
    <div className="my-6 bg-flow-sand p-5 md:p-6">
      <p className="flow-label mb-3">Formatos para imprimir o guardar en PDF</p>
      <ul className="space-y-1">
        {Object.entries(FORMS).map(([kind, f]) => (
          <li key={kind}>
            <Link to={path(`/formatos/${kind}`)} className="flex min-h-11 items-center gap-3 underline underline-offset-2">
              <Printer size={16} strokeWidth={1.5} aria-hidden="true" /> {f.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Contenido extra que va después del texto de una sección (no cambia el texto legal)
function SectionExtra({ kind, id }) {
  if (kind === 'terminos' && id === 'pqr') return <PqrBlock heading={false} className="my-6" />;
  if (kind === 'cambios' && id === 'como-hacer-tus-solicitudes') return <FormsBox />;
  return null;
}

function Toc({ sections }) {
  const items = sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="block py-1.5 hover:underline">{s.title}</a></li>);
  return (
    <>
      <details className="flow-legal-toc border-y border-flow-stone lg:hidden">
        <summary className="flow-label flex min-h-12 cursor-pointer list-none items-center justify-between">
          Índice <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
        </summary>
        <ol className="pb-4 text-sm">{items}</ol>
      </details>
      <nav aria-label="Índice" className="flow-legal-toc hidden lg:block">
        <div className="sticky top-[calc(var(--flow-header-h,64px)+24px)] max-h-[calc(100vh-var(--flow-header-h,64px)-48px)] overflow-y-auto pr-2">
          <p className="flow-label mb-3 text-flow-muted">Índice</p>
          <ol className="text-sm">{items}</ol>
        </div>
      </nav>
    </>
  );
}

// /terminos, /privacidad, /cambios, /envios, /preguntas-frecuentes, /promociones: texto de los Word
// aprobados (content/flowLegal.js) con índice por secciones.
export default function Policy({ kind }) {
  const { store } = useStore();
  const path = useStorePath();
  const location = useLocation();
  const doc = LEGAL_DOCS[kind];
  useSeo(policySeo(useSeoContext(), { kind, doc, store }));

  // /terminos#pqr: después de que el layout sube al inicio, baja a la sección
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return undefined;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50);
    return () => clearTimeout(t);
  }, [location.pathname, location.hash]);

  if (!doc) return <PageNotFound homePath={path('/')} />;
  const effective = legalEffective(doc);
  const others = Object.entries(POLICIES).filter(([k]) => k !== kind);

  return (
    <article className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
      <header className="max-w-3xl">
        <h1 className="flow-display text-3xl [overflow-wrap:anywhere] md:text-4xl">{doc.title}</h1>
        {effective && <p className="mt-4 text-sm text-flow-muted"><LegalInline text={effective} /></p>}
      </header>
      <hr className="flow-rule my-8" />
      <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
        {doc.sections.length > 1 ? <Toc sections={doc.sections} /> : <div />}
        <div className="flow-legal mt-8 max-w-3xl lg:mt-0">
          <LegalBlocks blocks={doc.intro} />
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-t`} className="flow-legal-section">
              <h2 id={`${s.id}-t`} className="flow-legal-h2">{s.title}</h2>
              <LegalBlocks blocks={s.blocks} />
              <SectionExtra kind={kind} id={s.id} />
            </section>
          ))}
          <LegalBlocks blocks={doc.outro} />

          <nav aria-label="Otras políticas" className="flow-noprint mt-16 border-t border-flow-stone pt-6">
            <p className="flow-label mb-2 text-flow-muted">Otras políticas</p>
            <ul>
              {others.map(([k, p]) => (
                <li key={k}>
                  <Link to={path(`/${k}`)} className="flex min-h-11 items-center justify-between gap-4 border-b border-flow-stone py-2 text-sm">
                    {p.title} <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
                  </Link>
                </li>
              ))}
              <li>
                <Link to={path('/formatos')} className="flex min-h-11 items-center justify-between gap-4 border-b border-flow-stone py-2 text-sm">
                  Formatos de retracto y garantía <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </article>
  );
}
