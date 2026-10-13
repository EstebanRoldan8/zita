import logoNegro from '../assets/logo/flow-logo-negro.png';

// Proporción real del PNG (15501 × 10417 px). Se muestra con width/height explícitos,
// sin sombras, rotación ni deformación. Área de seguridad: padding ≈ alto de una "O".
const RATIO = 15501 / 10417;

export default function Logo({ height = 40, variant = 'negro', className = '' }) {
  const width = Math.round(height * RATIO);
  const safeArea = Math.round(height * 0.25);

  if (variant === 'blanco') {
    // TODO: falta flow-logo-blanco.png en src/store/assets/logo/. Placeholder de texto marcado.
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={{ padding: safeArea }}
        data-placeholder="logo-blanco" title="Placeholder: falta el logo blanco de Flow">
        <span className="flow-display text-flow-white" style={{ fontSize: height * 0.55, letterSpacing: '0.3em' }}>FLOW</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex ${className}`} style={{ padding: safeArea }}>
      <img src={logoNegro} alt="Flow" width={width} height={height} decoding="async"
        style={{ width, height, objectFit: 'contain' }} />
    </span>
  );
}
