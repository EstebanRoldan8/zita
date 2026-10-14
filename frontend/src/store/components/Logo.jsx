import negroWebp from '../assets/logo/flow-logo-negro.webp';
import negroPng from '../assets/logo/flow-logo-negro-900.png';
import blancoWebp from '../assets/logo/flow-logo-blanco.webp';
import blancoPng from '../assets/logo/flow-logo-blanco.png';

// Logos optimizados (900 × 246 px, recortados al borde; ver scripts/optimize-logo.mjs).
// width/height explícitos para no causar saltos de layout. Sin sombras, rotación ni deformación.
// Área de seguridad: padding ≈ alto de una "O" del wordmark.
export const LOGO_RATIO = 900 / 246;
const SOURCES = {
  negro: { webp: negroWebp, png: negroPng },
  blanco: { webp: blancoWebp, png: blancoPng },
};

export default function Logo({ height = 40, variant = 'negro', className = '', safeArea = true, eager = false }) {
  const src = SOURCES[variant] || SOURCES.negro;
  const width = Math.round(height * LOGO_RATIO);
  const pad = safeArea ? Math.round(height * 0.2) : 0;
  return (
    <span className={`inline-flex ${className}`} style={{ padding: pad }}>
      <picture>
        <source srcSet={src.webp} type="image/webp" />
        <img src={src.png} alt="Flow" width={width} height={height} decoding="async"
          loading={eager ? 'eager' : 'lazy'} draggable="false"
          style={{ width, height, objectFit: 'contain', display: 'block', transition: 'width 200ms, height 200ms' }} />
      </picture>
    </span>
  );
}
