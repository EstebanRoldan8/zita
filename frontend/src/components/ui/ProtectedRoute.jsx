import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, ShieldOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

function Spinner() {
  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// Usuario autenticado sin negocio ni acceso de empleado (p. ej. el dueño le revocó el acceso)
function NoAccess() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#080d18] flex items-center justify-center px-4">
      <div className="bg-[#131929] border border-violet-500/20 rounded-2xl p-6 max-w-sm w-full text-center">
        <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
          <ShieldOff size={22} className="text-violet-400" />
        </div>
        <h1 className="text-white font-semibold text-lg mb-2">No tienes acceso al panel</h1>
        <p className="text-slate-400 text-sm mb-6">
          Tu cuenta no está vinculada a ningún negocio o el acceso fue retirado. Si crees que es un error, habla con el dueño del negocio.
        </p>
        <button
          onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
          className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2.5 rounded-lg transition"
        >
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

// role: 'owner' → solo dueño (el empleado va a /mi-panel) · 'employee' → solo empleado (el dueño va a /dashboard)
export default function ProtectedRoute({ children, adminOnly = false, role: requiredRole }) {
  const { user, isSuperadmin, loading, role } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (adminOnly && !isSuperadmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!adminOnly && isSuperadmin) {
    return <Navigate to="/admin" replace />;
  }

  if (adminOnly) return children;

  // Identidad aún cargando (p. ej. justo después de aceptar una invitación)
  if (role === null) return <Spinner />;
  if (role === 'none') return <NoAccess />;

  if (requiredRole === 'owner' && role === 'employee') {
    return <Navigate to="/mi-panel" replace />;
  }
  if (requiredRole === 'employee' && role === 'owner') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
