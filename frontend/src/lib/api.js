import axios from 'axios';
import { supabase } from './supabase';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
});

// Adjunta el JWT del usuario en cada request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

// Si el backend responde 401, cierra sesión y redirige al login
// Si el backend responde 403 SUBSCRIPTION_EXPIRED, redirige a suscripción
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await supabase.auth.signOut();
      window.location.href = '/login';
    } else if (error.response?.status === 403 && error.response?.data?.code === 'SUBSCRIPTION_EXPIRED') {
      window.alert('Tu suscripción ha vencido. Renueva tu plan para continuar.');
      window.location.href = '/dashboard/suscripcion';
    }
    return Promise.reject(error);
  }
);

export default api;
