// ZITA - Main application entry point
import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { startKeepAlive } from './lib/keepAlive';
import ProtectedRoute from './components/ui/ProtectedRoute';
import Layout from './components/ui/Layout';
import AdminLayout from './components/ui/AdminLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Contacto from './pages/Contacto';
import Enterprise from './pages/Enterprise';
import Planes from './pages/Planes';
import Demo from './pages/Demo';
import Partners from './pages/Partners';
import RegistroPartner from './pages/RegistroPartner';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Terms from './pages/Terms';
import DataDeletion from './pages/DataDeletion';
import Dashboard from './pages/business/Dashboard';
import Appointments from './pages/business/Appointments';
import Clients from './pages/business/Clients';
import Services from './pages/business/Services';
import Employees from './pages/business/Employees';
import Cash from './pages/business/Cash';
import Products from './pages/business/Products';
import Orders from './pages/business/Orders';
import Settings from './pages/business/Settings';
import Analytics from './pages/business/Analytics';
import Subscription from './pages/business/Subscription';
import AdminDashboard from './pages/admin/Dashboard';
import Businesses from './pages/admin/Businesses';
import BusinessDetail from './pages/admin/BusinessDetail';
import AdminSupport from './pages/admin/Support';
import AdminNotifications from './pages/admin/Notifications';
import CajaAdmin from './pages/admin/CajaAdmin';
import LeadsAdmin from './pages/admin/LeadsAdmin';
import AsistenteAdmin from './pages/admin/AsistenteAdmin';
import Onboarding from './pages/business/Onboarding';
import Invitation from './pages/Invitation';
import StaffLayout, { StaffModuleRoute } from './components/ui/StaffLayout';
import MyAgenda from './pages/staff/MyAgenda';
import StaffClients from './pages/staff/StaffClients';
import StaffProducts from './pages/staff/StaffProducts';
import MyCommissions from './pages/staff/MyCommissions';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 60_000 },
  },
});

// Tienda pública de Flow: carga diferida, fuera de AuthProvider, ProtectedRoute y Layout del panel
const StoreApp = lazy(() => import('./store/StoreApp'));

// Dominio propio: si el hostname es VITE_STORE_HOST, la raíz sirve la tienda de VITE_STORE_HOST_SLUG
const STORE_HOST = import.meta.env.VITE_STORE_HOST;
const STORE_HOST_SLUG = import.meta.env.VITE_STORE_HOST_SLUG;
const isStoreHost = typeof window !== 'undefined' && !!STORE_HOST && !!STORE_HOST_SLUG
  && window.location.hostname.toLowerCase() === String(STORE_HOST).toLowerCase();

export default function App() {
  useEffect(() => {
    startKeepAlive();
  }, []);

  if (isStoreHost) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/*" element={<StoreApp slugOverride={STORE_HOST_SLUG} />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/tienda/:slug/*" element={<Suspense fallback={null}><StoreApp /></Suspense>} />
          <Route path="*" element={<PanelApp />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Sitio de ZITA y panel (sin cambios): AuthProvider solo envuelve estas rutas
function PanelApp() {
  return (
        <AuthProvider>
          <Routes>
            {/* Públicas */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/contacto" element={<Contacto />} />
            <Route path="/planes" element={<Planes />} />
            <Route path="/enterprise" element={<Enterprise />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="/partners" element={<Partners />} />
            <Route path="/partners/registro" element={<RegistroPartner />} />
            <Route path="/privacidad" element={<PrivacyPolicy />} />
            <Route path="/terminos" element={<Terms />} />
            <Route path="/eliminar-datos" element={<DataDeletion />} />
            {/* Invitación de empleado (pública: abrirla no consume el enlace) */}
            <Route path="/invitacion/:token" element={<Invitation />} />

            {/* Onboarding */}
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute role="owner">
                  <Onboarding />
                </ProtectedRoute>
              }
            />

            {/* Panel de negocio (solo dueño: el empleado se redirige a /mi-panel) */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute role="owner">
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="citas"      element={<Appointments />} />
              <Route path="clientes"   element={<Clients />} />
              <Route path="servicios"  element={<Services />} />
              <Route path="empleados"  element={<Employees />} />
              <Route path="caja"       element={<Cash />} />
              <Route path="productos"  element={<Products />} />
              <Route path="pedidos" element={<Orders />} />
              <Route path="analiticas"    element={<Analytics />} />
              <Route path="configuracion" element={<Settings />} />
              <Route path="suscripcion"   element={<Subscription />} />
            </Route>

            {/* Panel del empleado (barbero): solo sus módulos; el dueño se redirige a /dashboard */}
            <Route
              path="/mi-panel"
              element={
                <ProtectedRoute role="employee">
                  <StaffLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<StaffModuleRoute module="agenda"><MyAgenda /></StaffModuleRoute>} />
              <Route path="clientes" element={<StaffModuleRoute module="clientes"><StaffClients /></StaffModuleRoute>} />
              <Route path="productos" element={<StaffModuleRoute module="productos"><StaffProducts /></StaffModuleRoute>} />
              <Route path="comisiones" element={<StaffModuleRoute module="comisiones"><MyCommissions /></StaffModuleRoute>} />
              <Route path="*" element={<Navigate to="/mi-panel" replace />} />
            </Route>

            {/* Panel superadmin */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute adminOnly>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="negocios" element={<Businesses />} />
              <Route path="negocios/:id" element={<BusinessDetail />} />
              <Route path="caja" element={<CajaAdmin />} />
              <Route path="leads" element={<LeadsAdmin />} />
              <Route path="asistente" element={<AsistenteAdmin />} />
              <Route path="soporte" element={<AdminSupport />} />
              <Route path="notificaciones" element={<AdminNotifications />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
  );
}
