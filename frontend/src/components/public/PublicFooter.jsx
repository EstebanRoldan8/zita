import { Link } from 'react-router-dom';

export default function PublicFooter() {
  return (
    <footer className="border-t border-violet-500/20 py-16 px-4 sm:px-6 lg:px-8 bg-[#050508] relative">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-12 mb-12">
          {/* Columna 1 */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="ZITA" className="h-10 w-10" />
              <span className="text-2xl font-black text-white">ZITA</span>
            </div>
            <p className="text-gray-400 text-sm">
              El asistente de WhatsApp con IA para negocios colombianos.
            </p>
            <a
              href="https://wa.me/573183790317"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-violet-400 hover:text-violet-300 transition text-sm"
            >
              WhatsApp →
            </a>
          </div>

          {/* Columna 2 */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h4 className="font-bold text-white mb-3 text-sm">Producto</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <Link to="/" className="hover:text-violet-400 transition">
                    Inicio
                  </Link>
                </li>
                <li>
                  <Link to="/planes" className="hover:text-violet-400 transition">
                    Planes
                  </Link>
                </li>
                <li>
                  <Link to="/demo" className="hover:text-violet-400 transition">
                    Demo
                  </Link>
                </li>
                <li>
                  <Link to="/enterprise" className="hover:text-violet-400 transition">
                    Enterprise
                  </Link>
                </li>
                <li>
                  <Link to="/partners" className="hover:text-violet-400 transition">
                    Partners
                  </Link>
                </li>
                <li>
                  <Link to="/login" className="hover:text-violet-400 transition">
                    Iniciar sesión
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <Link to="/privacidad" className="hover:text-violet-400 transition">
                    Privacidad
                  </Link>
                </li>
                <li>
                  <Link to="/terminos" className="hover:text-violet-400 transition">
                    Términos
                  </Link>
                </li>
                <li>
                  <Link to="/eliminar-datos" className="hover:text-violet-400 transition">
                    Eliminar datos
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Columna 3 */}
          <div className="space-y-4 text-center md:text-right">
            <h4 className="font-bold text-white">¿Listo para empezar?</h4>
            <Link
              to="/register"
              className="inline-block px-6 py-3 bg-gradient-to-r from-violet-600 to-violet-700 rounded-lg font-semibold hover:from-violet-700 hover:to-violet-800 transition"
            >
              Empezar gratis →
            </Link>
            <p className="text-xs text-gray-500">14 días gratis · Sin tarjeta</p>
          </div>
        </div>

        <div className="pt-8 border-t border-violet-500/10 text-center text-sm text-gray-500">
          <p>© 2026 ZITA · Hecho en Cali, Colombia 🇨🇴</p>
        </div>
      </div>
    </footer>
  );
}
