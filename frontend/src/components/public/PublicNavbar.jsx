import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Home, CreditCard, Play, Building2, Handshake, LogIn } from 'lucide-react';

export default function PublicNavbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id) => {
    if (location.pathname === '/') {
      const element = document.getElementById(id);
      if (element) element.scrollIntoView({ behavior: 'smooth' });
      setIsMobileOpen(false);
    } else {
      window.location.href = `/#${id}`;
    }
  };

  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  return (
    <nav
      className={`fixed w-full z-50 transition-all duration-300 ${
        isScrolled ? 'bg-[#0a0a0f]/95 backdrop-blur border-b border-violet-500/10' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="ZITA" className="h-8 w-8" />
          <span className="text-2xl font-black text-white">ZITA</span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex gap-8 items-center">
          <Link to="/" className="text-gray-300 hover:text-white transition text-sm">
            Inicio
          </Link>
          <Link to="/planes" className="text-gray-300 hover:text-white transition text-sm">
            Planes
          </Link>
          <Link to="/demo" className="text-gray-300 hover:text-white transition text-sm">
            Demo
          </Link>
          <Link to="/enterprise" className="text-gray-300 hover:text-white transition text-sm">
            Enterprise
          </Link>
          <Link to="/partners" className="text-gray-300 hover:text-white transition text-sm">
            Partners
          </Link>
        </div>

        <div className="hidden md:flex gap-4 items-center">
          <Link to="/login" className="px-4 py-2 text-sm border border-violet-500/50 rounded-lg hover:border-violet-400 transition">
            Iniciar sesión
          </Link>
          <Link to="/register" className="px-4 py-2 text-sm bg-violet-600 rounded-lg hover:bg-violet-700 transition font-medium">
            Empezar gratis
          </Link>
        </div>

        {/* Mobile */}
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="md:hidden text-white"
        >
          {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isMobileOpen && (
        <div className="fixed top-0 left-0 w-full h-screen md:hidden bg-[#0a0a0f] z-9999 overflow-y-auto">
          <div className="sticky top-0 bg-[#0a0a0f] flex items-center justify-between px-4 py-4 border-b border-slate-700">
            <span className="text-white font-black text-lg">Menu</span>
            <button
              onClick={() => setIsMobileOpen(false)}
              className="text-white"
            >
              <X size={24} />
            </button>
          </div>
          <div className="flex flex-col px-4 py-6 space-y-1">
            {/* Navigation Links */}
            <button
              onClick={() => { document.getElementById('/') ? window.location.href = '/' : window.location.href = '/'; setIsMobileOpen(false); }}
              className="flex items-center gap-3 text-gray-300 hover:text-white py-3 font-medium text-lg transition"
            >
              <Home size={20} />
              Inicio
            </button>
            <Link
              to="/planes"
              onClick={() => setIsMobileOpen(false)}
              className="flex items-center gap-3 text-gray-300 hover:text-white py-3 font-medium text-lg transition"
            >
              <CreditCard size={20} />
              Planes
            </Link>
            <Link
              to="/demo"
              onClick={() => setIsMobileOpen(false)}
              className="flex items-center gap-3 text-gray-300 hover:text-white py-3 font-medium text-lg transition"
            >
              <Play size={20} />
              Demo
            </Link>
            <Link
              to="/enterprise"
              onClick={() => setIsMobileOpen(false)}
              className="flex items-center gap-3 text-gray-300 hover:text-white py-3 font-medium text-lg transition"
            >
              <Building2 size={20} />
              Enterprise
            </Link>
            <Link
              to="/partners"
              onClick={() => setIsMobileOpen(false)}
              className="flex items-center gap-3 text-gray-300 hover:text-white py-3 font-medium text-lg transition"
            >
              <Handshake size={20} />
              Partners
            </Link>

            {/* Divider */}
            <div className="my-4 border-t border-slate-700"></div>

            {/* Action Buttons */}
            <Link
              to="/login"
              onClick={() => setIsMobileOpen(false)}
              className="flex items-center justify-center gap-2 text-violet-400 border border-violet-500/50 rounded-lg hover:border-violet-400 transition py-3 font-medium"
            >
              <LogIn size={18} />
              Iniciar sesión
            </Link>
            <Link
              to="/register"
              onClick={() => setIsMobileOpen(false)}
              className="w-full text-center px-4 py-3 text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition font-semibold"
            >
              Empezar gratis →
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
