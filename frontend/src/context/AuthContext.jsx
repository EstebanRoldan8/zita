import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import api from '../lib/api';

const AuthContext = createContext(null);

// role: null (cargando) | 'owner' (dueño) | 'employee' (barbero) | 'none' (sin negocio ni acceso)
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [allowedModules, setAllowedModules] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const lastUserId = useRef(undefined);
  const lastBusinessId = useRef(null);

  // Las queryKey no incluyen el negocio: al cambiar de usuario se vacía la caché
  // para no mostrar datos de la cuenta anterior. Refrescos de token (mismo id) no la tocan.
  const syncUser = (nextUser) => {
    const nextId = nextUser?.id ?? null;
    if (lastUserId.current !== undefined && lastUserId.current !== nextId) {
      queryClient.clear();
    }
    lastUserId.current = nextId;
    setUser(nextUser);
  };

  // Mismo criterio si cambia el negocio activo sin cambiar de usuario
  useEffect(() => {
    const nextId = business?.id ?? null;
    if (lastBusinessId.current && nextId && lastBusinessId.current !== nextId) {
      queryClient.clear();
    }
    if (nextId) lastBusinessId.current = nextId;
  }, [business?.id, queryClient]);

  const setOwnerBusiness = async () => {
    const res = await api.get('/api/businesses/me');
    setBusiness(res.data?.data ?? null);
    setRole('owner');
    setEmployee(null);
    setAllowedModules(null);
  };

  // Identidad: /api/me dice el rol. Si /api/me no responde (backend sin desplegar aún),
  // se intenta el flujo del dueño de siempre para no dejar fuera a nadie.
  const loadBusiness = async () => {
    const me = await api.get('/api/me')
      .then((r) => r.data?.data ?? null)
      .catch(() => null);

    try {
      if (me?.role === 'employee') {
        setBusiness(me.business ?? null);
        setEmployee(me.employee ?? null);
        setAllowedModules(Array.isArray(me.allowed_modules) ? me.allowed_modules : []);
        setRole('employee');
        return 'employee';
      }
      await setOwnerBusiness();
      return 'owner';
    } catch (err) {
      console.error('Error cargando datos del negocio:', err.message);
      setBusiness(null);
      setEmployee(null);
      setAllowedModules(null);
      // 404: el usuario no es dueño ni empleado activo. Otro error (red, 500): se conserva el
      // comportamiento previo (panel del dueño sin datos) en vez de mostrar "sin acceso".
      const nextRole = err.response?.status === 404 ? 'none' : 'owner';
      setRole(nextRole);
      return nextRole;
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      syncUser(session?.user ?? null);
      if (session?.user) {
        loadBusiness().finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      syncUser(session?.user ?? null);
      if (session?.user) {
        loadBusiness();
      } else {
        setBusiness(null);
        setRole(null);
        setEmployee(null);
        setAllowedModules(null);
      }
    });

    // El backend dejó de reconocer al usuario (p. ej. el dueño revocó el acceso del empleado)
    const onAccessLost = () => {
      setRole((prev) => (prev === 'employee' ? 'none' : prev));
    };
    window.addEventListener('zita:access-lost', onAccessLost);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('zita:access-lost', onAccessLost);
    };
  }, []);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    syncUser(data.user);
    const nextRole = await loadBusiness();
    return { ...data, role: nextRole };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    lastBusinessId.current = null;
    setBusiness(null);
    setRole(null);
    setEmployee(null);
    setAllowedModules(null);
  };

  const superadminEmail = import.meta.env.VITE_SUPERADMIN_EMAIL || 'esteban.zita.ia@gmail.com';
  const isSuperadmin = user?.email === superadminEmail;

  return (
    <AuthContext.Provider value={{
      user, business, setBusiness, loading, login, logout, isSuperadmin,
      role, employee, allowedModules, reloadIdentity: loadBusiness,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
