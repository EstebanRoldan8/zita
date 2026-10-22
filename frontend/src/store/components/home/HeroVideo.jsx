import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { canLoadHeroVideo } from '../../lib/heroVideo';

// Fondo del hero con video vertical (decorativo, aria-hidden).
// - Primero se pinta la portada (poster); el video se monta DESPUÉS del evento load y entra con un fundido en
//   canplay. No se carga con movimiento reducido, ahorro de datos o 2G (queda la portada).
// - Hero alto (móvil/tablet vertical): el video cubre todo. Hero ancho (>= 1024 px o más ancho que alto): el
//   video va centrado sin recortar y los lados se rellenan con una copia muy difuminada y oscura. Esa copia se
//   dibuja en un canvas diminuto a partir del MISMO <video> (no hay segunda descarga ni segundo decodificador).
// - Se pausa si la pestaña no está visible o el hero sale de pantalla. Si falla o el navegador bloquea el
//   autoplay, queda la portada sin errores.
// - Loop sin corte seco: ~0,5 s antes del final el video se desvanece sobre la portada (casi el fotograma
//   inicial) y al reiniciar entra con fundido. Se decide por currentTime en cada cuadro: si el video está
//   pausado o la pestaña oculta, simplemente espera.
// - Botón pausar/reproducir (esquina inferior): con movimiento reducido o ahorro de datos el video no arranca
//   solo, pero la persona puede darle play (recién ahí se descarga). Sin esas preferencias arranca solo y el
//   botón lo pausa. La elección se recuerda en la sesión (sessionStorage).
const WIDE_QUERY = '(min-width: 1024px), (orientation: landscape)';
const BLUR_W = 18;
const BLUR_H = 32;
const LOOP_FADE_S = 0.5; // segundos antes del final en que empieza el fundido de salida
const CHOICE_KEY = 'flow-hero-video'; // 'play' | 'pause' (elección de la persona en esta sesión)

const readChoice = () => { try { return window.sessionStorage.getItem(CHOICE_KEY); } catch { return null; } };
const saveChoice = (v) => { try { window.sessionStorage.setItem(CHOICE_KEY, v); } catch { /* sin almacenamiento */ } };

export default function HeroVideo({ video }) {
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [load, setLoad] = useState(false);
  // La portada ya se pintó (o no hay): recién ahí se puede pedir el video
  const [posterDone, setPosterDone] = useState(!video.poster);
  const [ready, setReady] = useState(false);
  const [dip, setDip] = useState(false); // fundido del loop (final → inicio)
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE_QUERY).matches);
  // ¿Debe reproducirse? Elección de la persona en la sesión; si no eligió, arranca solo salvo con movimiento
  // reducido, ahorro de datos o 2G (canLoadHeroVideo).
  const [choice, setChoice] = useState(() => (typeof window === 'undefined' ? null : readChoice()));
  const [autoOk] = useState(() => canLoadHeroVideo());
  const wantPlay = choice === 'play' || (choice === null && autoOk);
  const wantRef = useRef(wantPlay);
  useEffect(() => { wantRef.current = wantPlay; }, [wantPlay]);
  const [playing, setPlaying] = useState(false);

  // Hero ancho o alto (cambia al girar o redimensionar)
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE_QUERY);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  // El video se pide después del load de la página y de la portada (no compite con ella ni con el LCP).
  // Si la persona le da play, se pide ya (en toggle).
  useEffect(() => {
    if (!wantPlay || load || !posterDone) return undefined;
    let t;
    const start = () => { t = setTimeout(() => setLoad(true), 0); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => { window.removeEventListener('load', start); clearTimeout(t); };
  }, [posterDone, wantPlay, load]);

  // Pausa fuera de pantalla o con la pestaña oculta; reanuda al volver
  useEffect(() => {
    const v = videoRef.current;
    const wrap = wrapRef.current;
    if (!load || !v || !wrap) return undefined;
    let visible = true;
    const sync = () => {
      if (visible && document.visibilityState === 'visible' && wantRef.current) v.play().catch(() => {});
      else v.pause();
    };
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.05 })
      : null;
    io?.observe(wrap);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => { io?.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [load, wantPlay]);

  const toggle = () => {
    const v = videoRef.current;
    if (playing) {
      setChoice('pause'); saveChoice('pause');
      v?.pause();
    } else {
      setChoice('play'); saveChoice('play');
      wantRef.current = true;
      if (v) v.play().catch(() => {});
      else setLoad(true); // con movimiento reducido o ahorro de datos el video recién se descarga aquí
    }
  };

  // Fundido del loop: sale cerca del final, entra cuando el video vuelve a empezar
  useEffect(() => {
    const v = videoRef.current;
    if (!ready || !v) return undefined;
    let raf = 0;
    let dipping = false;
    const tick = () => {
      const d = v.duration;
      const t = v.currentTime;
      if (Number.isFinite(d) && d > LOOP_FADE_S * 4) {
        if (!dipping && d - t <= LOOP_FADE_S) { dipping = true; setDip(true); }
        else if (dipping && t < LOOP_FADE_S) { dipping = false; setDip(false); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); setDip(false); };
  }, [ready]);

  // Copia difuminada de los lados (solo en hero ancho y con el video listo): un canvas de 18x32 px escalado
  useEffect(() => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!ready || !wide || !v || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    let last = 0;
    const draw = (now) => {
      if (now - last > 66 && !v.paused) { // ~15 fps alcanza para un fondo borroso
        try { ctx.drawImage(v, 0, 0, BLUR_W, BLUR_H); } catch { /* fotograma aún no disponible */ }
        last = now;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ready, wide]);

  const fade = 'transition-opacity duration-500 ease-in-out';
  const shown = ready && !dip ? 'opacity-100' : 'opacity-0';
  const blur = { filter: 'blur(28px) brightness(0.45) saturate(1.1)', transform: 'scale(1.15)' };

  return (
    <>
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-flow-black" aria-hidden="true">
      {/* Portada: fondo inmediato */}
      {video.poster && (
        wide ? (
          <>
            <img src={video.poster} alt="" className="absolute inset-0 h-full w-full object-cover" style={blur} decoding="async" />
            <img src={video.poster} alt="" className="absolute inset-y-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2"
              style={{ aspectRatio: '9 / 16' }} fetchpriority="high" decoding="async" onLoad={() => setPosterDone(true)} onError={() => setPosterDone(true)} />
          </>
        ) : (
          <img src={video.poster} alt="" className="absolute inset-0 h-full w-full object-cover" fetchpriority="high" decoding="async"
            onLoad={() => setPosterDone(true)} onError={() => setPosterDone(true)} />
        )
      )}
      {load && (
        <>
          {wide && (
            <canvas ref={canvasRef} width={BLUR_W} height={BLUR_H}
              className={`absolute inset-0 h-full w-full object-cover ${fade} ${shown}`} style={blur} />
          )}
          <video ref={videoRef} src={video.src} muted loop playsInline autoPlay={wantPlay} preload="metadata"
            disablePictureInPicture disableRemotePlayback tabIndex={-1}
            onCanPlay={(e) => {
              if (wantRef.current) e.currentTarget.play().then(() => setReady(true)).catch(() => {});
              else setReady(true);
            }}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onError={() => { setReady(false); setPlaying(false); }}
            className={wide
              ? `absolute inset-y-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2 ${fade} ${shown}`
              : `absolute inset-0 h-full w-full object-cover ${fade} ${shown}`}
            style={wide ? { aspectRatio: '9 / 16' } : undefined} />
        </>
      )}
    </div>
    {/* Pausar / reproducir: esquina inferior derecha, fuera del texto y los botones del hero */}
    <button type="button" onClick={toggle} aria-label={playing ? 'Pausar video' : 'Reproducir video'} aria-pressed={playing}
      className="absolute bottom-4 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border text-flow-white md:bottom-8 md:right-8"
      style={{ borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(28,28,28,0.45)' }}>
      {playing ? <Pause size={18} strokeWidth={1.5} aria-hidden="true" /> : <Play size={18} strokeWidth={1.5} className="ml-0.5" aria-hidden="true" />}
    </button>
    </>
  );
}
