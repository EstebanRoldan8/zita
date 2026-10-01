import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
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

  const loadBusiness = async () => {
    try {
      const res = await api.get('/api/businesses/me');
      setBusiness(res.data?.data ?? null);
    } catch (err) {
      console.error('Error cargando datos del negocio:', err.message);
      setBusiness(null);
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
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    syncUser(data.user);
    await loadBusiness();
    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    lastBusinessId.current = null;
    setBusiness(null);
  };

  const superadminEmail = import.meta.env.VITE_SUPERADMIN_EMAIL || 'esteban.zita.ia@gmail.com';
  const isSuperadmin = user?.email === superadminEmail;

  return (
    <AuthContext.Provider value={{ user, business, setBusiness, loading, login, logout, isSuperadmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
