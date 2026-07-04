import { Lock } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function SubscriptionExpiredBanner() {
  const [isExpired, setIsExpired] = useState(
    () => localStorage.getItem('subscription_expired') === 'true'
  );
  const navigate = useNavigate();
  const location = useLocation();

  // Vive en Layout (fuera del Outlet), así que no vuelve a montarse al
  // navegar entre Citas/Clientes/Caja/etc. Re-chequeamos el flag en cada
  // cambio de ruta y también al volver a la pestaña, para que el aviso
  // aparezca apenas el backend marque la suscripción como vencida.
  useEffect(() => {
    const check = () => setIsExpired(localStorage.getItem('subscription_expired') === 'true');
    check();
    window.addEventListener('storage', check);
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('focus', check);
    };
  }, [location.pathname]);

  // No bloquear la propia página de suscripción: ahí es donde el usuario renueva.
  if (!isExpired || location.pathname === '/dashboard/suscripcion') return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0a0a0f] border border-violet-500/30 rounded-2xl w-full max-w-md p-8 shadow-xl text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-violet-600 rounded-full flex items-center justify-center">
            <Lock size={32} className="text-white" />
          </div>
        </div>
        <h2 className="text-white text-2xl font-bold mb-2">Tu plan ha vencido</h2>
        <p className="text-slate-400 text-sm mb-6">
          Renueva tu suscripción para recuperar el acceso completo.
        </p>
        <button
          onClick={() => navigate('/dashboard/suscripcion')}
          className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-3 rounded-lg transition"
        >
          Renovar plan
        </button>
      </div>
    </div>
  );
}
