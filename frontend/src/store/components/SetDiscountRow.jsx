import { formatCOP } from '../lib/format';
import { SET_PROMO } from '../lib/setPromo';

// Línea "Descuento por set (5 %)  −$ 7.240" del resumen; no se muestra si no hay descuento
export default function SetDiscountRow({ amount, label = SET_PROMO.label, className = 'mt-2' }) {
  if (!(Number(amount) > 0)) return null;
  return (
    <div className={`${className} flex justify-between gap-3 text-sm`}>
      <span className="min-w-0">{label}</span>
      <span className="flex-shrink-0">−{formatCOP(amount)}</span>
    </div>
  );
}
