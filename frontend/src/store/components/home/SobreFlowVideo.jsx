import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { flowContent } from '../../content/flowContent';

// Video "Sobre FLOW" (YouTube Short, 9:16). Mismo patrón que InstagramReels: al abrir la página no se
// carga nada de YouTube; solo la portada local. Al dar play se monta el iframe de youtube-nocookie en
// el mismo recuadro (misma proporción, sin saltos de layout).
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const embedUrl = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;

export default function SobreFlowVideo({ path }) {
  const v = flowContent.aboutVideo;
  const id = String(v?.youtubeId || '').trim();
  const [playing, setPlaying] = useState(false);
  // Sin portada (o si no carga): queda el recuadro azul de la marca con el botón de play
  const [coverFailed, setCoverFailed] = useState(false);
  const frameRef = useRef(null);
  // El botón desaparece al dar play: el foco pasa al video para no perderse
  useEffect(() => { if (playing) frameRef.current?.focus(); }, [playing]);
  if (!ID_RE.test(id)) return null;

  return (
    <section className="bg-flow-white" aria-labelledby="flow-sobre-video">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:gap-16 md:px-8 md:py-24">
        <div className="md:max-w-md md:justify-self-end">
          {v.eyebrow && <p className="flow-label text-flow-stone">{v.eyebrow}</p>}
          <h2 id="flow-sobre-video" className="flow-serif mt-3 text-3xl md:text-4xl">{v.title}</h2>
          {v.text && <p className="mt-4 text-sm text-flow-muted md:text-base">{v.text}</p>}
          {path && v.linkLabel && (
            <Link to={path('/sobre-flow')} className="flow-label mt-8 inline-block border-b border-flow-black pb-1">{v.linkLabel}</Link>
          )}
        </div>
        {/* Ancho: hasta 380 px y nunca más alto que ~85 % de la pantalla */}
        <div className="mx-auto w-full md:mx-0 md:justify-self-start" style={{ maxWidth: 'min(380px, calc(85svh * 9 / 16))' }}>
          <div className="relative aspect-[9/16] bg-flow-navy">
            {playing ? (
              <iframe ref={frameRef} src={embedUrl(id)} title={v.iframeTitle || v.title} loading="lazy"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
                className="absolute inset-0 h-full w-full border-0" />
            ) : (
              <button type="button" onClick={() => setPlaying(true)} aria-label={v.playLabel || 'Ver video'}
                className="group absolute inset-0 block h-full w-full">
                {v.cover && !coverFailed && (
                  <img src={v.cover} alt={v.coverAlt || ''} width="720" height="1280" loading="lazy" decoding="async"
                    onError={() => setCoverFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
                )}
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full border text-flow-white transition-transform duration-200 group-hover:scale-105"
                    style={{ borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(28,28,28,0.35)' }}>
                    <Play size={30} strokeWidth={1.5} className="ml-1" />
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
