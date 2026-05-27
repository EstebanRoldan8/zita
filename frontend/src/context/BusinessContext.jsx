import { createContext, useContext, useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

const BusinessContext = createContext(null);

export function BusinessProvider({ children }) {
  const { user, loading } = useAuth();
  const [business, setBusiness] = useState(null);
  const [loadingBusiness, setLoadingBusiness] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setBusiness(null);
      setLoadingBusiness(false);
      return;
    }

    const loadBusiness = async () => {
      try {
        const res = await api.get('/api/businesses/me');
        setBusiness(res.data?.data || null);
      } catch (err) {
        console.error('Error loading business:', err?.message);
        setBusiness(null);
      } finally {
        setLoadingBusiness(false);
      }
    };

    loadBusiness();
  }, [user?.id, loading]);

  return (
    <BusinessContext.Provider value={{ business, loadingBusiness }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('useBusiness debe usarse dentro de BusinessProvider');
  return context;
}
