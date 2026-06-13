import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AIAssistant from './AIAssistant';
import {
  LayoutDashboard, Building2, HeadphonesIcon, Bell,
  LogOut, Menu, X, ChevronRight, Zap, DollarSign,
  Users, TrendingUp
} from 'lucide-react';

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/negocios', label: 'Negocios', icon: Building2 },
  { to: '/admin/caja', label: 'Caja ZITA', icon: DollarSign },
  { to: '/admin/leads', label: 'Leads', icon: TrendingUp },
  { to: '/admin/soporte', label: 'Soporte', icon: HeadphonesIcon },
  { to: '/admin/notificaciones', label: 'Notificaciones', icon: Bell },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <span className="text-white font-bold text-lg">ZITA</span>
            <div className="flex items-center gap-1 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
              <span className="text-emerald-400 text-xs font-medium">Superadmin</span>
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <span className="text-violet-400 text-xs font-bold">
              {user?.email?.[0]?.toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">Esteban</p>
            <p className="text-slate-500 text-xs truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-400/10 text-sm transition-all"
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#0a0a0f] overflow-hidden">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-60 bg-[#0f0f17] border-r border-white/10 shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-[#0f0f17] border-r border-white/10 z-50">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-[#0f0f17] border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="text-white font-bold">ZITA</span>
            <span className="text-emerald-400 text-xs">Superadmin</span>
          </div>
          <button onClick={() => setMenuOpen(true)} className="text-slate-400 hover:text-white p-1">
            <Menu size={20} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <AIAssistant />
    </div>
  );
}
