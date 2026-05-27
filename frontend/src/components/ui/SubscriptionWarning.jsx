import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

export default function SubscriptionWarning() {
  const [sub, setSub] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSub = async () => {
      try {
        const { data } = await api.get('/api/subscription');
        setSub(data.data);
      } catch (err) {
        console.error('Error fetching subscription:', err);
      }
    };
    fetchSub();
  }, []);

  if (dismissed || !sub || (sub.estado !== 'grace' && sub.estado !== 'expired')) {
    return null;
  }

  const isExpired = sub.estado === 'expired';
  const bgColor = isExpired ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30';
  const textColor = isExpired ? 'text-red-300' : 'text-yellow-300';
  const iconColor = isExpired ? 'text-red-400' : 'text-yellow-400';
  const message = isExpired
    ? '🔴 Tu cuenta está suspendida. Renueva tu plan para recuperar el acceso completo.'
    : `⚠️ Tu suscripción venció. Tienes 3 días para renovar antes de que se suspenda tu cuenta.`;

  return (
    <div className={`border-b ${bgColor} px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between`}>
      <div className="flex items-center gap-3">
        <AlertTriangle size={18} className={iconColor} />
        <p className={`text-sm font-medium ${textColor}`}>
          {message}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => navigate('/dashboard/suscripcion')}
          className={`text-xs font-semibold px-3 py-1.5 rounded transition ${
            isExpired
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-yellow-600 hover:bg-yellow-500 text-white'
          }`}
        >
          Renovar ahora
        </button>
        <button
          onClick={() => setDismissed(true)}
          className={`p-1 rounded transition ${textColor} hover:opacity-70`}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
