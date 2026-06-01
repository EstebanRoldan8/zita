import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, CheckCircle } from 'lucide-react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import api from '../../lib/api';

export default function ContactSupport({ open, onClose }) {
  const [message, setMessage] = useState('');
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  useLockBodyScroll(open);

  const handleSend = async () => {
    setError('');
    setLoading(true);
    try {
      await api.post('/api/support/contact', { message: message.trim() || null });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al enviar. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => { setSent(false); setMessage(''); setError(''); }, 300);
  };

  if (!open) return null;

  const modal = (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div className="bg-[#1e293b] border border-white/15 rounded-2xl shadow-2xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-white font-semibold text-lg">Contactar soporte</h3>
            <button onClick={handleClose} className="text-slate-500 hover:text-white transition">
              <X className="w-5 h-5 sm:w-4 sm:h-4 md:w-5 md:h-5" />
            </button>
          </div>

          {sent ? (
            <div className="text-center py-6 sm:py-5 md:py-8 flex-1 flex flex-col items-center justify-center">
              <div className="w-12 h-12 sm:w-11 sm:h-11 md:w-14 md:h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-3 md:mb-4">
                <CheckCircle className="w-6 h-6 sm:w-5 sm:h-5 md:w-6 md:h-6 text-emerald-400" />
              </div>
              <p className="text-white font-medium text-sm sm:text-sm md:text-base">Mensaje enviado</p>
              <p className="text-slate-400 text-xs sm:text-xs md:text-sm mt-1 sm:mt-1 md:mt-2">Te contactaré pronto.</p>
              <button onClick={handleClose} className="mt-4 sm:mt-4 md:mt-6 text-violet-400 hover:text-violet-300 text-xs transition">
                Cerrar
              </button>
            </div>
          ) : (
            <>
              <p className="text-slate-400 text-sm mb-4">
                ¿Tienes un problema o pregunta sobre ZITA?
              </p>
              {error && (
                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-3">{error}</p>
              )}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe tu consulta (opcional)..."
                className="w-full bg-[#0f172a] border border-white/10 text-white rounded-xl px-4 h-32 text-sm placeholder-white/40 focus:border-violet-500 focus:outline-none transition resize-none mb-4"
              />
              <button
                onClick={handleSend}
                disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium h-11 rounded-xl transition flex items-center justify-center gap-2"
              >
                {loading ? 'Enviando...' : <><Send size={14} /> Contactar soporte</>}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
}
