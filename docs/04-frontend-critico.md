# ZITA - Frontend Crítico

## Estructura de Rutas (App.jsx)

```
/                          → Redirect a /login
/login                     → Login (público)
/register                  → Register (público)
/privacidad                → Privacy Policy (público)
/terminos                  → Terms of Service (público)
/eliminar-datos            → Data Deletion (público)

/dashboard                 → Protected (ProtectedRoute)
  /dashboard               → Dashboard (homepage del negocio)
  /dashboard/citas         → Appointments list
  /dashboard/clientes      → Clients list
  /dashboard/servicios     → Services CRUD
  /dashboard/empleados     → Employees CRUD
  /dashboard/caja          → Cash (income) CRUD + export
  /dashboard/productos     → Products CRUD + inventory
  /dashboard/analiticas    → Analytics (heatmap, retention)
  /dashboard/configuracion → Settings (hours, business data)

/admin                     → Protected (ProtectedRoute adminOnly)
  /admin                   → Admin Dashboard (all metrics)
  /admin/negocios          → List all businesses
  /admin/negocios/:id      → Business detail + edit
  /admin/soporte           → Support tickets
  /admin/notificaciones    → Notifications feed

*                          → 404 Redirect a /login
```

---

## AuthContext.jsx

**Propósito:** Gestionar estado de autenticación del usuario

**Estado:**
```javascript
{
  user: {
    id: "uuid",
    email: "user@example.com",
    ...supabaseAuthUser
  },
  business: {
    id: "uuid",
    name: "Mi Negocio",
    business_type: "barberia|spa|tienda|etc",
    ...businessData
  },
  loading: true|false,
  isSuperadmin: true|false,
}
```

**Métodos:**
```javascript
const { user, business, setBusiness, loading, login, logout, isSuperadmin } = useAuth();

// login(email, password) → { user, session, weakPassword }
// logout() → clears auth + setBusiness(null)
// isSuperadmin → true si user.email === VITE_SUPERADMIN_EMAIL
```

**Flujo:**
1. `AuthProvider` llama `supabase.auth.getSession()` al montar
2. Suscribe a cambios de auth con `onAuthStateChange()`
3. Disponible en toda la app con `useAuth()`
4. `business` se puede setear manualmente después del login

**Variables de Entorno (Frontend):**
```javascript
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxx
VITE_SUPERADMIN_EMAIL=esteban.zita.ia@gmail.com
VITE_API_URL=https://zita-production-1634.up.railway.app
```

---

## Componentes Clave

### ProtectedRoute
```javascript
<ProtectedRoute adminOnly={false}>
  <Component />
</ProtectedRoute>
```
- Si no autenticado → redirige a /login
- Si `adminOnly=true` y no es superadmin → redirige a /dashboard
- Muestra spinner mientras `loading=true`

### Layout (Business Dashboard)
```
┌─ Sidebar ────────────────────────┐
│ • Inicio                          │
│ • Citas                           │
│ • Clientes                        │
│ • Empleados                       │
│ • Servicios                       │
│ • Productos                       │
│ • Caja                            │
│ • Analíticas                      │
│ • Configuración                   │
│ • ¿Necesitas ayuda?              │
│ • Cerrar sesión                   │
└───────────────────────────────────┘
<Outlet /> → Página actual (Dashboard, Citas, etc)
```

### AdminLayout
```
Sidebar (Admin)
├─ Dashboard (admin)
├─ Negocios
├─ Soporte
└─ Notificaciones

<Outlet /> → Página actual
```

### Sidebar (Responsive)
- **Desktop:** Siempre visible (fixed left)
- **Mobile:** Hamburger button → drawer overlay
- **NavItems:** Filtrados por business_type (pendiente)
- **Footer:** Mi negocio + email + Help + Logout

---

## Páginas Principales

### Login (pages/Login.jsx)
- Email + Password input
- Botón "Ingresar" con loading state
- Link a Register
- Private policy links

### Register (pages/Register.jsx)
- Email + Password + Business name + Business type
- Business types:
  - `barberia` (barbershop - default)
  - `spa` (spa & beauty)
  - `veterinaria` (veterinary)
  - `dentista` (dental)
  - `tienda` (retail shop - nuevo)
- Auto-login después de registro exitoso

### Dashboard (pages/business/Dashboard.jsx)
- **Tarjetas KPI:** Revenue hoy, citas hoy, clientes activos
- **Upcoming appointments:** Próximas 5 citas
- **Recent clients:** Últimos clientes
- **Quick actions:** Buttons a crear cita, cliente, servicio

### Appointments (pages/business/Appointments.jsx)
- Tabla/lista de citas
- Filtros: estado (pending, confirmed, completed, cancelled)
- CRUD: crear, editar, cancelar cita
- Integración con calendario (opcional)

### Clients (pages/business/Clients.jsx)
- Tabla de clientes
- Búsqueda por nombre/teléfono
- Perfil del cliente:
  - Datos: nombre, teléfono, email
  - Historial de citas
  - Total gastado
  - Visitas acumuladas
  - Puntos de fidelización
- CRUD: crear, editar, eliminar cliente

### Services (pages/business/Services.jsx)
- Tabla de servicios
- Columnas: nombre, duración, precio, activo
- CRUD: crear, editar, deletear servicio
- Toggle activo/inactivo

### Products (pages/business/Products.jsx)
- **Tabla de productos:** id, imagen, nombre, stock, precio, variantes
- **Imagen:** Upload JPG/PNG/WebP (máx 2MB)
- **Variantes:** Toggle `has_variants` → tabla de atributos
- **Stock:** Total = suma de variantes (si has_variants=true)
- **Venta:** Modal con selector de variante si disponible
- CRUD: crear, editar, deletear producto
- Variantes CRUD: crear, editar, deletear variant

### Employees (pages/business/Employees.jsx)
- Tabla de empleados
- Columnas: nombre, teléfono, comisión (%), comisión fija
- Performance metrics: citas este mes, ingresos generados
- CRUD: crear, editar, deletear empleado

### Cash (pages/business/Cash.jsx)
- **Ingresos:** tabla de movimientos (fecha, descripción, cantidad)
- **Filtros:** rango fechas, categoría (servicios, productos, otro)
- **Export:** botones PDF y Excel
- **Manual entry:** crear ingreso manualmente
- Total ingresos: sum(amount)

### Expenses (pages/business/Expenses.jsx)
- Tabla de gastos
- Columnas: fecha, categoría, descripción, monto
- CRUD: crear, editar, deletear gasto
- Filtros: rango fechas, categoría

### Analytics (pages/business/Analytics.jsx)
- **Heatmap:** días/horas con más citas
- **Retention:** cliente retention over time
- **Trends:** revenue, appointments over time
- **Charts:** usando recharts o similar

### Settings (pages/business/Settings.jsx)
- **Datos del negocio:** nombre, teléfono, dirección, email
- **Business type:** selector (barberia, spa, veterinaria, dentista, tienda)
- **Horarios:** inicio, fin, días cerrados
- **Configuración de recompensas:** visitas requeridas para recompensa
- **Integración WhatsApp:** phone_number_id (read-only)

### Admin Dashboard (pages/admin/Dashboard.jsx)
- **Total metrics:** total businesses, total users, revenue, appointments
- **Top businesses:** negocios con más ingresos
- **Recent activities:** log de acciones

### Admin Businesses (pages/admin/Businesses.jsx)
- Tabla de todos los negocios
- Filtros: status (trial, active, inactive)
- Búsqueda: por nombre, email, business_type
- Link a detalles de cada negocio

### Admin BusinessDetail (pages/admin/BusinessDetail.jsx)
- **Datos del negocio:** nombre, email, teléfono, status
- **Impersonation:** botón para asumir ese negocio → ver su dashboard
- **Métricas:** citas, clientes, revenue total
- **Logs:** últimas actividades
- **Acciones:** activar/desactivar, cambiar status

---

## Convenciones de Datos

### User Object (Supabase Auth)
```javascript
{
  id: "uuid",
  email: "user@example.com",
  app_metadata: { provider: 'email' },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-05-19T...",
  ...
}
```

### Business Object
```javascript
{
  id: "uuid",
  user_id: "uuid",
  name: "Mi Barbería",
  business_type: "barberia",
  status: "trial|active|inactive",
  owner_email: "user@example.com",
  phone: "+57...",
  address: "Calle 5 #123",
  whatsapp_phone_number_id: "xxx",
  created_at: "2026-05-19T...",
}
```

### Appointment Object
```javascript
{
  id: "uuid",
  business_id: "uuid",
  client_id: "uuid|null",
  service_id: "uuid",
  employee_id: "uuid|null",
  scheduled_at: "2026-05-19T15:30:00Z",
  status: "pending|confirmed|completed|cancelled",
  price: 50000,
  notes: "Corte + barba",
  source: "manual|whatsapp",
  created_at: "2026-05-19T..."
}
```

---

## Estado Responsive Actual

| Pantalla | Desktop | Tablet | Mobile |
|----------|---------|--------|--------|
| Login | ✅ | ✅ | ✅ |
| Register | ✅ | ✅ | ✅ |
| Sidebar | ✅ | ✅ | ✅ (hamburger) |
| Dashboard | ✅ | ⚠️ | ❌ |
| Appointments | ✅ | ⚠️ | ❌ |
| Clients | ✅ | ⚠️ | ❌ |
| Services | ✅ | ⚠️ | ❌ |
| Products | ✅ | ⚠️ | ❌ |
| Employees | ✅ | ⚠️ | ❌ |
| Cash | ✅ | ⚠️ | ❌ |
| Analytics | ✅ | ⚠️ | ❌ |
| Settings | ✅ | ⚠️ | ❌ |

**Próxima tarea:** agregar breakpoints md/sm/xs a todas las tablas + modals
