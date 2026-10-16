import { colorHex, isLightColor } from '../lib/collections';

// Punto de color. Color desconocido → círculo stone con borde (nunca rompe); el nombre va en
// title y aria-label. Los colores claros y los bicolor (gradiente partido de colorMap) llevan borde stone.
export default function ColorDot({ name, size = 12, hex: hexProp, className = '', label = true }) {
  const hex = hexProp || colorHex(name);
  const known = !!hex;
  const light = isLightColor(hex);
  return (
    <span
      className={`inline-block flex-shrink-0 rounded-full ${className}`}
      title={name || undefined}
      {...(label ? { role: 'img', 'aria-label': name || 'Color' } : { 'aria-hidden': true })}
      style={{
        width: size,
        height: size,
        background: known ? hex : 'var(--flow-stone)',
        border: `1px solid ${known && !light ? 'transparent' : 'var(--flow-stone)'}`,
        boxShadow: known ? 'none' : 'inset 0 0 0 2px var(--flow-white)',
      }}
    />
  );
}
