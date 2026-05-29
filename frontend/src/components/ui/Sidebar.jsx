import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Calendar,
  Users,
  Scissors,
  LogOut,
  Zap,
  UserCog,
  Wallet,
  Settings,
  Package,
  BarChart2,
  HelpCircle,
  Menu,
  X,
  ShoppingBag,
  CreditCard,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import ContactSupport from './ContactSupport';
import api from '../../lib/api';

const navGroups = [
  {
    group: 'Principal',
    items: [
      { to: '/dashboard',               label: 'Inicio',        icon: LayoutDashboard, end: true, types: ['all'] },
      { to: '/dashboard/citas',         label: 'Citas',         icon: Calendar,                   types: ['barberia', 'spa', 'veterinaria', 'dentista'] },
      { to: '/dashboard/clientes',      label: 'Clientes',      icon: Users,                      types: ['all'] },
    ]
  },
  {
    group: 'Gestión',
    items: [
      { to: '/dashboard/empleados',     label: 'Empleados',     icon: UserCog,                    types: ['all'] },
      { to: '/dashboard/servicios',     label: 'Servicios',     icon: Scissors,                   types: ['all'] },
      { to: '/dashboard/productos',     label: 'Productos',     icon: Package,                    types: ['all'] },
    ]
  },
  {
    group: 'Reportes',
    items: [
      { to: '/dashboard/caja',          label: 'Caja',          icon: Wallet,                     types: ['all'] },
      { to: '/dashboard/analiticas',    label: 'Analíticas',    icon: BarChart2,                  types: ['all'] },
      { to: '/dashboard/configuracion', label: 'Configuración', icon: Settings,                   types: ['all'] },
    ]
  }
];

const MODULE_ACCESS = {
  lite: [
    '/dashboard',
    '/dashboard/citas',
    '/dashboard/servicios',
    '/dashboard/empleados',
    '/dashboard/caja',
    '/dashboard/configuracion'
  ],
  estandar: [
    '/dashboard',
    '/dashboard/citas',
    '/dashboard/clientes',
    '/dashboard/empleados',
    '/dashboard/servicios',
    '/dashboard/productos',
    '/dashboard/caja',
    '/dashboard/analiticas',
    '/dashboard/configuracion'
  ],
  pro: [
    '/dashboard',
    '/dashboard/citas',
    '/dashboard/clientes',
    '/dashboard/empleados',
    '/dashboard/servicios',
    '/dashboard/productos',
    '/dashboard/caja',
    '/dashboard/analiticas',
    '/dashboard/configuracion'
  ]
};

export default function Sidebar() {
  const { user, business, logout } = useAuth();
  const navigate = useNavigate();
  const [contactOpen, setContactOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  useLockBodyScroll(isOpen);

  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then(r => r.data.data),
    staleTime: 5 * 60 * 1000
  });

  const modules = business?.modules ?? null;
  const isLoadingSub = sub === undefined;
  const plan = sub?.plan || 'estandar';
  const enTrial = sub?.estado === 'trial';
  const planForAccess = isLoadingSub ? null : (plan || 'estandar');

  const businessType = (business?.business_type || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const filterNavItem = (item) => {
    const planRoutes = MODULE_ACCESS[planForAccess] || MODULE_ACCESS['estandar'];
    if (!planRoutes.includes(item.to)) return false;
    if (!item.types.includes('all') && businessType && !item.types.includes(businessType)) return false;
    if (modules) {
      const moduleKey = item.to.split('/').pop();
      if (modules[moduleKey] !== undefined) return modules[moduleKey] === true;
    }
    return true;
  };

  const filteredNavGroups = isLoadingSub
    ? [{ group: 'Principal', items: navGroups[0].items.filter(i => i.to === '/dashboard') }]
    : navGroups.map(g => ({
        ...g,
        items: g.items.filter(filterNavItem)
      })).filter(g => g.items.length > 0);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const closeSidebar = () => setIsOpen(false);

  return (
    <>
      {/* Header móvil fijo */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[#0a0f1e] border-b border-white/5 z-40 flex items-center justify-between px-4">
        {/* Hamburguesa izquierda */}
        <button
          onClick={() => setIsOpen(true)}
          className="w-10 h-10 flex items-center justify-center"
        >
          <Menu size={20} className="text-white/70" />
        </button>

        {/* Logo centrado */}
        <div className="absolute left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="ZITA" className="h-6 w-6 object-contain" />
            <span className="text-white font-bold text-lg tracking-tight">ZITA</span>
          </div>
        </div>

        {/* Campana derecha */}
        <div className="w-10" />
      </div>

      {/* Overlay - solo en móvil cuando está abierto */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed left-0 md:top-0 w-[210px]
        md:h-full md:top-0 h-[calc(100vh-56px)] top-14
        bg-[#0a0f1e] border-r border-white/5 z-40
        flex flex-col
        transform transition-transform duration-300
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>

      {/* Logo y botón X */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 pb-4 mb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ZITA" className="h-8 w-8 object-contain" />
          <span className="text-white font-bold text-2xl tracking-tight">ZITA</span>
        </div>
        <button
          onClick={closeSidebar}
          className="md:hidden text-white/50 hover:text-white transition"
        >
          <X size={20} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {filteredNavGroups.map((navGroup) => (
          <div key={navGroup.group}>
            <div className="text-xs uppercase tracking-widest text-white/30 px-3 mt-4 mb-1">
              {navGroup.group}
            </div>
            <div className="space-y-0.5">
              {navGroup.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={closeSidebar}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/10 pt-3 mt-auto flex-shrink-0 space-y-2">
        <div className="px-3 py-2">
          <p className="text-white text-sm font-medium truncate">Mi negocio</p>
          <p className="text-white/50 text-xs truncate">{user?.email}</p>
        </div>
        <NavLink
          to="/dashboard/suscripcion"
          onClick={closeSidebar}
          className={({ isActive }) =>
            `flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-violet-600/20 text-white'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`
          }
        >
          <CreditCard size={17} />
          Mi suscripción
        </NavLink>
        <button
          onClick={() => {
            setContactOpen(true);
            closeSidebar();
          }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors"
        >
          <HelpCircle size={16} />
          <span className="truncate">¿Necesitas ayuda?</span>
        </button>
        <button
          onClick={() => {
            handleLogout();
            closeSidebar();
          }}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut size={17} />
          Cerrar sesión
        </button>
      </div>

      <ContactSupport open={contactOpen} onClose={() => setContactOpen(false)} />
    </aside>
    </>
  );
}
