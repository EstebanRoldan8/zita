import { CalendarCheck, Users, Package, Wallet } from 'lucide-react';

// Menú del panel del empleado. `module` debe coincidir con allowed_modules de GET /api/me.
export const STAFF_NAV = [
  { to: '/mi-panel',            label: 'Mi agenda',      icon: CalendarCheck, module: 'agenda', end: true },
  { to: '/mi-panel/clientes',   label: 'Clientes',       icon: Users,         module: 'clientes' },
  { to: '/mi-panel/productos',  label: 'Productos',      icon: Package,       module: 'productos' },
  { to: '/mi-panel/comisiones', label: 'Mis comisiones', icon: Wallet,        module: 'comisiones' },
];
