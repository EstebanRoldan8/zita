import { useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import { STAFF_NAV } from './staffNav';

// Guarda de módulo dentro del panel del empleado: si no lo tiene, va al primero permitido
export function StaffModuleRoute({ module, children }) {
  const { allowedModules } = useAuth();
  const allowed = allowedModules || [];
  if (allowed.includes(module)) return children;
  const first = STAFF_NAV.find((i) => allowed.includes(i.module));
  if (first && first.to !== '/mi-panel') return <Navigate to={first.to} replace />;
  return (
    <div className="text-center py-20 text-slate-500 text-sm">
      Tu negocio no tiene módulos habilitados para el equipo. Habla con el dueño.
    </div>
  );
}

// Layout del panel del empleado: mismo estilo que el del dueño, sin asistente IA, alertas ni suscripción
export default function StaffLayout() {
  const { user, business, employee, allowedModules, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  useLockBodyScroll(isOpen);

  const items = STAFF_NAV.filter((i) => (allowedModules || []).includes(i.module));
  const current = items.find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setIsOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-violet-600/20 text-white border-l-2 border-violet-500'
                : 'text-white/50 hover:bg-white/5 hover:text-white/70'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={17} className={isActive ? 'text-violet-400' : 'text-white/50'} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-[#080d18]">
      {/* Header móvil */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[#0a0f1e] border-b border-white/5 z-40 flex items-center justify-between px-4">
        <button onClick={() => setIsOpen(true)} className="w-10 h-10 flex items-center justify-center" aria-label="Abrir menú">
          <Menu size={20} className="text-white/70" />
        </button>
        <div className="absolute left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="ZITA" className="h-6 w-6 object-contain" />
            <span className="text-white font-bold text-lg tracking-tight">{current?.label || 'ZITA'}</span>
          </div>
        </div>
        <div className="w-10" />
      </div>

      {isOpen && <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setIsOpen(false)} />}

      <aside className={`
        md:fixed md:left-0 md:top-0 md:h-full md:w-[210px] md:z-40 md:translate-x-0
        ${isOpen ? 'fixed left-0 top-0 h-full w-72 z-50 translate-x-0' : 'fixed -left-72 top-0 h-full w-72 z-50'}
        bg-[#0f172a] border-r border-white/5 flex flex-col transition-transform duration-300
      `}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo.png" alt="ZITA" className="h-6 w-6 object-contain" />
            <span className="text-white font-bold text-lg tracking-tight">ZITA</span>
          </div>
          <button onClick={() => setIsOpen(false)} className="md:hidden text-white/50 hover:text-white transition" aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        {nav}

        <div className="px-3 py-4 border-t border-white/10 mt-auto flex-shrink-0 space-y-2">
          <div className="px-3 py-2">
            <p className="text-white text-sm font-medium truncate">{employee?.name || 'Mi panel'}</p>
            <p className="text-white/50 text-xs truncate">{business?.name}</p>
            <p className="text-white/30 text-xs truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="md:ml-[210px] min-h-screen flex-1 px-4 sm:px-6 py-6 pt-20 md:pt-8 w-full min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
