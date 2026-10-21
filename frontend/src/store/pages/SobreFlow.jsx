import { Link } from 'react-router-dom';
import { useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { aboutSeo, aboutText } from '../lib/seo';
import { flowContent } from '../content/flowContent';
import { getActiveCollection } from '../lib/collections';
import { Storytelling, ValuesStrip, Capsules } from '../components/home/HomeSections';
import { PageNotFound } from '../components/States';
import SobreFlowVideo from '../components/home/SobreFlowVideo';
import { aboutVideoId } from '../lib/aboutVideo';

// /sobre-flow: texto de marca (flowContent.about) + video (flowContent.aboutVideo) + storytelling de la colección activa
export default function SobreFlow() {
  const path = useStorePath();
  const collection = getActiveCollection();
  const about = aboutText();
  const hasStory = (collection?.storytelling || []).length > 0;
  const video = !!aboutVideoId();
  useSeo(aboutSeo(useSeoContext()));

  if (!about && !hasStory) return <PageNotFound homePath={path('/')} />;

  return (
    <>
      {/* Título y slogan centrados; debajo el texto y, si hay video, el video (al lado desde 1024 px) */}
      <header className="bg-flow-sand">
        <div className={`mx-auto px-6 py-16 md:py-24 ${video ? 'max-w-6xl' : 'max-w-3xl'}`}>
          <div className="text-center">
            <p className="flow-label">Sobre FLOW</p>
            <h1 className="flow-collection-name mt-5 text-5xl md:text-7xl">{flowContent.brand.name}</h1>
            <p className="flow-script mt-6 text-4xl">{flowContent.brand.slogan}</p>
          </div>
          <div className={video ? 'mt-8 grid gap-10 lg:mt-12 lg:grid-cols-2 lg:items-center lg:gap-16' : ''}>
            {about && (
              <p className={`mx-auto max-w-xl whitespace-pre-line text-center text-sm leading-relaxed md:text-base ${video ? 'lg:mr-0 lg:text-left' : 'mt-8'}`}>{about}</p>
            )}
            {video && <SobreFlowVideo className="mx-auto lg:ml-0" />}
          </div>
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
