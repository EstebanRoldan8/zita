import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);

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
      setUser(session?.user ?? null);
      if (session?.user) {
        loadBusiness().finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
    await loadBusiness();
    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setBusiness(null);
  };

  const isSuperadmin = user?.email === import.meta.env.VITE_SUPERADMIN_EMAIL;

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
