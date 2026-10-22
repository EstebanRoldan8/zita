import ColorDot from './ColorDot';

// Puntos de color que cambian la foto (tarjetas y "Producto ícono"). Botones accesibles: aria-label con el
// color, aria-pressed en el activo (anillo), foco visible, teclado y táctil. Tocar el activo lo deselecciona.
// onPreview: vista previa al pasar el mouse o enfocar (opcional).
export default function ColorSwatches({ colors, selected, onSelect, onPreview, label, max = 5, size = 14, className = '' }) {
  if (!colors?.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} role="group" aria-label={label}>
      {colors.slice(0, max).map((c) => {
        const on = selected === c.key;
        return (
          <button key={c.key} type="button" title={c.name} aria-label={`Ver en ${c.name}`} aria-pressed={on}
            onClick={() => onSelect(on ? '' : c.key)}
            onMouseEnter={onPreview ? () => onPreview(c.key) : undefined} onMouseLeave={onPreview ? () => onPreview('') : undefined}
            onFocus={onPreview ? () => onPreview(c.key) : undefined} onBlur={onPreview ? () => onPreview('') : undefined}
            className={`flex h-7 w-7 items-center justify-center rounded-full ${on ? 'ring-1 ring-flow-black' : ''} ${c.available ? '' : 'opacity-40'}`}
            style={on ? { boxShadow: '0 0 0 1px var(--flow-black)' } : undefined}>
            <ColorDot name={c.name} size={size} label={false} />
          </button>
        );
      })}
      {colors.length > max && <span className="text-xs text-flow-muted">+{colors.length - max}</span>}
    </div>
  );
}
