import { Link } from 'react-router-dom';
import { useStorePath } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { flowContent } from '../content/flowContent';
import { getActiveCollection } from '../lib/collections';
import { Storytelling, ValuesStrip, Capsules } from '../components/home/HomeSections';
import { PageNotFound } from '../components/States';

// /sobre-flow: texto de marca (flowContent.about) + storytelling de la colección activa
export default function SobreFlow() {
  const path = useStorePath();
  const collection = getActiveCollection();
  const about = typeof flowContent.about === 'string' && flowContent.about.trim() ? flowContent.about.trim() : null;
  const hasStory = (collection?.storytelling || []).length > 0;
  useDocumentMeta(`Sobre FLOW — ${flowContent.brand.slogan}`, about?.slice(0, 150) || collection?.intro || flowContent.brand.slogan);

  if (!about && !hasStory) return <PageNotFound homePath={path('/')} />;

  return (
    <>
      <header className="bg-flow-sand">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-24">
          <p className="flow-label">Sobre FLOW</p>
          <h1 className="flow-collection-name mt-5 text-5xl md:text-7xl">{flowContent.brand.name}</h1>
          <p className="flow-script mt-6 text-4xl">{flowContent.brand.slogan}</p>
          {about && <p className="mx-auto mt-8 max-w-xl whitespace-pre-line text-sm leading-relaxed md:text-base">{about}</p>}
        </div>
      </header>
      <Storytelling collection={collection} />
      <ValuesStrip values={flowContent.values} />
      <Capsules collection={collection} path={path} />
      {collection && (
        <div className="pb-20 text-center">
          <Link to={path(`/coleccion/${collection.slug}`)} className="flow-btn flow-btn-primary">{collection.hero?.cta1 || collection.label}</Link>
        </div>
      )}
    </>
  );
}
