// Las fuentes de Flow se cargan solo al entrar a la tienda (no en el panel).
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Playfair+Display:wght@400;500;600&family=Cormorant+Garamond:wght@400;500;600&family=Mrs+Saint+Delafield&display=swap';

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
  document.head.append(pre, link);
}
