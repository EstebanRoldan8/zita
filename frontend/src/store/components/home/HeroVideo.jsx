import { useEffect, useRef, useState } from 'react';
import { canLoadHeroVideo } from '../../lib/heroVideo';

// Fondo del hero con video vertical (decorativo, aria-hidden).
// - Primero se pinta la portada (poster); el video se monta DESPUÉS del evento load y entra con un fundido en
//   canplay. No se carga con movimiento reducido, ahorro de datos o 2G (queda la portada).
// - Hero alto (móvil/tablet vertical): el video cubre todo. Hero ancho (>= 1024 px o más ancho que alto): el
//   video va centrado sin recortar y los lados se rellenan con una copia muy difuminada y oscura. Esa copia se
//   dibuja en un canvas diminuto a partir del MISMO <video> (no hay segunda descarga ni segundo decodificador).
// - Se pausa si la pestaña no está visible o el hero sale de pantalla. Si falla o el navegador bloquea el
//   autoplay, queda la portada sin errores.
const WIDE_QUERY = '(min-width: 1024px), (orientation: landscape)';
const BLUR_W = 18;
const BLUR_H = 32;

export default function HeroVideo({ video }) {
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [load, setLoad] = useState(false);
  // La portada ya se pintó (o no hay): recién ahí se puede pedir el video
  const [posterDone, setPosterDone] = useState(!video.poster);
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE_QUERY).matches);

  // Hero ancho o alto (cambia al girar o redimensionar)
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE_QUERY);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  // El video se pide después del load de la página y de la portada (no compite con ella ni con el LCP)
  useEffect(() => {
    if (!posterDone || !canLoadHeroVideo()) return undefined;
    let t;
    const start = () => { t = setTimeout(() => setLoad(true), 0); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => { window.removeEventListener('load', start); clearTimeout(t); };
  }, [posterDone]);

  // Pausa fuera de pantalla o con la pestaña oculta; reanuda al volver
  useEffect(() => {
    const v = videoRef.current;
    const wrap = wrapRef.current;
    if (!load || !v || !wrap) return undefined;
    let visible = true;
    const sync = () => {
      if (visible && document.visibilityState === 'visible') v.play().catch(() => {});
      else v.pause();
    };
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.05 })
      : null;
    io?.observe(wrap);
    document.addEventListener('visibilitychange', sync);
    return () => { io?.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [load]);

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

  const fade = 'transition-opacity duration-700 ease-out';
  const blur = { filter: 'blur(28px) brightness(0.45) saturate(1.1)', transform: 'scale(1.15)' };

  return (
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
              className={`absolute inset-0 h-full w-full object-cover ${fade} ${ready ? 'opacity-100' : 'opacity-0'}`} style={blur} />
          )}
          <video ref={videoRef} src={video.src} muted loop playsInline autoPlay preload="metadata"
            disablePictureInPicture disableRemotePlayback tabIndex={-1}
            onCanPlay={(e) => { e.currentTarget.play().then(() => setReady(true)).catch(() => {}); }}
            onError={() => setReady(false)}
            className={wide
              ? `absolute inset-y-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2 ${fade} ${ready ? 'opacity-100' : 'opacity-0'}`
              : `absolute inset-0 h-full w-full object-cover ${fade} ${ready ? 'opacity-100' : 'opacity-0'}`}
            style={wide ? { aspectRatio: '9 / 16' } : undefined} />
        </>
      )}
    </div>
  );
}
