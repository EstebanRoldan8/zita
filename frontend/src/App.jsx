// ZITA - Main application entry point
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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

            {/* Panel de negocio */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
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
              <Route path="soporte" element={<AdminSupport />} />
              <Route path="notificaciones" element={<AdminNotifications />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
