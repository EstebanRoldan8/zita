import { useEffect } from 'react';
import { useStore } from './useStore';
import { SITE_NAME, LOCALE, THEME_COLOR, DEFAULT_IMAGE, DEFAULT_IMAGE_SIZE, absoluteUrl } from '../lib/seo';

// { origin, base } para construir URLs absolutas con lib/seo.js. Si la tienda tiene dominio propio
// (VITE_STORE_HOST + VITE_STORE_HOST_SLUG), su canonical es ese dominio sin prefijo /tienda/:slug, también
// cuando se visita desde otro host (zita-alpha.vercel.app/tienda/flow): así no hay contenido duplicado.
export function useSeoContext() {
  const { base, slug } = useStore();
  const host = import.meta.env.VITE_STORE_HOST;
  const hostSlug = String(import.meta.env.VITE_STORE_HOST_SLUG || '').toLowerCase();
  if (typeof window !== 'undefined' && host && hostSlug && slug === hostSlug) {
    return { origin: `${window.location.protocol}//${String(host).trim()}`, base: '' };
  }
  return { origin: typeof window !== 'undefined' ? window.location.origin : '', base: base || '' };
}

// Aplica en <head> lo que describe lib/seo.js (título, description, robots, canonical, Open Graph,
// Twitter, JSON-LD) y al desmontar deja todo como estaba (el index.html es compartido con el panel).
export function useSeo(seo) {
  const key = JSON.stringify(seo || null);
  useEffect(() => {
    const s = JSON.parse(key);
    if (!s || !s.title) return undefined;
    const head = document.head;
    const undo = [];

    const setMeta = (attr, name, content) => {
      if (content === null || content === undefined || content === '') return;
      let el = head.querySelector(`meta[${attr}="${name}"]`);
      if (el) {
        const prev = el.getAttribute('content');
        undo.push(() => el.setAttribute('content', prev ?? ''));
      } else {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        head.appendChild(el);
        undo.push(() => el.remove());
      }
      el.setAttribute('content', String(content));
    };

    const prevTitle = document.title;
    document.title = s.title;
    undo.push(() => { document.title = prevTitle; });

    const image = absoluteUrl(window.location.origin, s.image || DEFAULT_IMAGE);
    setMeta('name', 'description', s.description);
    setMeta('name', 'robots', s.noindex ? 'noindex,nofollow' : 'index,follow');
    setMeta('name', 'theme-color', THEME_COLOR);
    setMeta('property', 'og:title', s.title);
    setMeta('property', 'og:description', s.description);
    setMeta('property', 'og:type', s.type || 'website');
    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('property', 'og:locale', LOCALE);
    setMeta('property', 'og:url', s.canonical || window.location.href.split('#')[0]);
    setMeta('property', 'og:image', image);
    setMeta('property', 'og:image:alt', s.imageAlt || s.title);
    if (!s.image) {
      setMeta('property', 'og:image:width', DEFAULT_IMAGE_SIZE.width);
      setMeta('property', 'og:image:height', DEFAULT_IMAGE_SIZE.height);
    }
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', s.title);
    setMeta('name', 'twitter:description', s.description);
    setMeta('name', 'twitter:image', image);
    for (const [attr, name, content] of s.meta || []) setMeta(attr, name, content);

    if (s.canonical) {
      let link = head.querySelector('link[rel="canonical"]');
      if (link) {
        const prev = link.getAttribute('href');
        undo.push(() => link.setAttribute('href', prev ?? ''));
      } else {
        link = document.createElement('link');
        link.rel = 'canonical';
        head.appendChild(link);
        undo.push(() => link.remove());
      }
      link.setAttribute('href', s.canonical);
    }

    // Un solo bloque JSON-LD de la tienda a la vez
    head.querySelectorAll('script[data-flow-seo]').forEach((el) => el.remove());
    if (Array.isArray(s.jsonLd) && s.jsonLd.length) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.flowSeo = 'true';
      script.textContent = JSON.stringify(s.jsonLd.length === 1 ? s.jsonLd[0] : s.jsonLd);
      head.appendChild(script);
      undo.push(() => script.remove());
    }

    return () => { for (let i = undo.length - 1; i >= 0; i -= 1) undo[i](); };
  }, [key]);
}
