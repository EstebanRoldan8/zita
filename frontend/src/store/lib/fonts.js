// Las fuentes de Flow (Montserrat, Playfair Display, Cormorant Garamond, Autography) son locales
// y se declaran en flow.css: la tienda no contacta con Google Fonts (política de privacidad).
// Aquí solo se precarga el slogan, que está en el primer pantallazo del inicio.
import autographyUrl from '../assets/fonts/autography-latin.woff2';

export function loadFlowFonts() {
  if (typeof document === 'undefined' || document.getElementById('flow-fonts')) return;
  // crossorigin es obligatorio en preload de fuentes (si no, el navegador la descarga dos veces).
  const script = document.createElement('link');
  script.id = 'flow-fonts';
  script.rel = 'preload';
  script.as = 'font';
  script.type = 'font/woff2';
  script.href = autographyUrl;
  script.crossOrigin = 'anonymous';
  document.head.append(script);
}
