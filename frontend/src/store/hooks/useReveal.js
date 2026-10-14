import { useEffect, useRef, useState } from 'react';

const prefersReduced = () => typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Aparición suave al entrar en pantalla (IntersectionObserver). Con reduced-motion o sin soporte
// el contenido es visible desde el inicio.
export function useReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(() => prefersReduced() || typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (visible || !ref.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);

  return [ref, visible];
}
