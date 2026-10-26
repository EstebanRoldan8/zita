import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';

// "← Volver" de las páginas legales y de ayuda. Si ya se navegó dentro de la tienda (location.key distinto
// de 'default'), vuelve a la página anterior; si la página se abrió directo (pestaña nueva), lleva al pedido
// cuando la bolsa tiene productos y, si no, al inicio de la tienda.
export default function BackLink() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = useStorePath();
  const { lines } = useCart();
  const go = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(path(lines.length > 0 ? '/checkout' : '/'));
  };
  return (
    <button type="button" onClick={go} className="flow-noprint -ml-3 mb-4 inline-flex min-h-12 items-center gap-2 px-3 text-sm font-medium hover:underline">
      <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" /> Volver
    </button>
  );
}
