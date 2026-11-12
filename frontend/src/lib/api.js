import axios from 'axios';
import { supabase } from './supabase';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 15000,
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
// Si el backend responde 403 SUBSCRIPTION_EXPIRED, guardar en localStorage
// Si respuesta exitosa, limpiar flag de suscripción expirada
api.interceptors.response.use(
  (response) => {
    if (localStorage.getItem('subscription_expired') === 'true') {
      localStorage.removeItem('subscription_expired');
    }
    return response;
  },
  async (error) => {
    if (error.response?.status === 401) {
      await supabase.auth.signOut();
      window.location.href = '/login';
    } else if (error.response?.status === 403 && error.response?.data?.code === 'SUBSCRIPTION_EXPIRED') {
      localStorage.setItem('subscription_expired', 'true');
    } else if (
      error.response?.status === 404 &&
      error.response?.data?.error === 'Negocio no encontrado' &&
      String(error.config?.url || '').startsWith('/api/me')
    ) {
      // El empleado perdió el acceso (revocado o desactivado): AuthContext lo saca del panel
      window.dispatchEvent(new Event('zita:access-lost'));
    }
    return Promise.reject(error);
  }
);

export default api;
