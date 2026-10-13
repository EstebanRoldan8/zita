import { useEffect } from 'react';

function setMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.dataset.flowStore = 'true';
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// document.title, meta description y Open Graph por página de la tienda
export function useDocumentMeta(title, description, image) {
  useEffect(() => {
    const previousTitle = document.title;
    if (title) document.title = title;
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    if (image) setMeta('property', 'og:image', image);
    return () => { document.title = previousTitle; };
  }, [title, description, image]);
}
