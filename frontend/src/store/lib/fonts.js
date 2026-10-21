// Las fuentes de Flow se cargan solo al entrar a la tienda (no en el panel).
// Autography (slogan) es propia y se declara en flow.css; aquí solo se precarga.
import autographyUrl from '../assets/fonts/autography-latin.woff2';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Playfair+Display:wght@400;500;600&family=Cormorant+Garamond:wght@400;500;600&display=swap';

export function loadFlowFonts() {
  if (typeof document === 'undefined' || document.getElementById('flow-fonts')) return;
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = 'https://fonts.gstatic.com';
  pre.crossOrigin = 'anonymous';
  const link = document.createElement('link');
  link.id = 'flow-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_HREF;
  // El slogan está en el primer pantallazo del inicio: precargar evita que se vea un rato con el respaldo.
  // crossorigin es obligatorio en preload de fuentes (si no, el navegador la descarga dos veces).
  const script = document.createElement('link');
  script.rel = 'preload';
  script.as = 'font';
  script.type = 'font/woff2';
  script.href = autographyUrl;
  script.crossOrigin = 'anonymous';
  document.head.append(pre, link, script);
}
