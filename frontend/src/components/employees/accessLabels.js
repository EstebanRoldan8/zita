// Estado del acceso de un empleado a su panel (GET /api/employees → access_status)
export const ACCESS_LABELS = {
  none:    { label: 'Sin acceso', cls: 'text-slate-400 bg-slate-700/40 border-slate-600/50' },
  invited: { label: 'Invitado',   cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  active:  { label: 'Activo',     cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
};
