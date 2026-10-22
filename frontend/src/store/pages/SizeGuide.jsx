import { useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { sizeGuideSeo } from '../lib/seo';
import { sizeGuide } from '../lib/policies';
import SizeGuideTable from '../components/SizeGuideTable';
import { PageNotFound } from '../components/States';

// /guia-de-tallas: las tablas de flowContent.sizeGuide (una por tipo de prenda) y su nota
export default function SizeGuide() {
  const path = useStorePath();
  const guide = sizeGuide();
  useSeo(sizeGuideSeo(useSeoContext()));
  if (!guide) return <PageNotFound homePath={path('/')} />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
      <h1 className="flow-display text-3xl md:text-4xl">{guide.title}</h1>
      {guide.intro && <p className="mt-4 text-sm text-flow-muted">{guide.intro}</p>}
      <div className="mt-10 space-y-12">
        {guide.tables.map((t) => <SizeGuideTable key={t.title} table={t} />)}
      </div>
      {guide.note && <p className="mt-10 bg-flow-sand p-6 text-sm leading-relaxed md:p-8">{guide.note}</p>}
    </div>
  );
}
