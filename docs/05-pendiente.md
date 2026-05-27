# ZITA - Pendiente (Roadmap)

**Estado del proyecto:** MVP funcional, en construcción

---

## Módulos Faltantes

### 1. Módulo TIENDA (Retail/E-Commerce)
**Estado:** 40% completo

✅ **Hecho:**
- Business type "tienda" en registro y settings
- Sistema de inventario con variantes de productos
- Upload de imágenes de productos (JPG, PNG, WebP - máx 2MB)
- Preview de imagen en tarjeta de producto
- Modal de venta con selector de variante
- Endpoints de producto_variants CRUD
- Tabla product_sales con variant_id

❌ **Falta:**
- Carrito de compras (frontend)
- Checkout (frontend)
- Integración de pago Wompi (backend + frontend)
- Facturación automática (PDF)
- Inventario: alertas de stock bajo
- Reporte de ventas por producto
- Dashboard tienda con métricas de conversión
- Aplicar descuentos/promociones
- Cupones de descuento

### 2. Módulo de Pedidos (Orders)
**Estado:** No iniciado

**Funcionalidad:**
- Historial de pedidos del cliente
- Estados de pedido: pendiente, pagado, enviado, entregado, cancelado
- Tracking de envío (si es shipping)
- Generación de factura PDF
- Email de confirmación de pedido

---

## Integraciones Pendientes

### 1. Wompi (Pagos)
**Estado:** Pendiente

- Crear cuenta en Wompi
- Obtener API keys (public + private)
- Crear checkout.js para frontend (iframe Wompi)
- Backend: crear endpoint POST /api/payments/wompi
  - Validar monto
  - Crear transacción en Wompi
  - Guardar en tabla payments (nueva)
  - Webhook de confirmación
  - Auto-confirmar pedido cuando pago exitoso

**Variables de entorno:**
```bash
WOMPI_PUBLIC_KEY=xxxxx
WOMPI_PRIVATE_KEY=xxxxx
WOMPI_API_URL=https://api.wompi.co
```

### 2. WhatsApp Cloud API (Completar)
**Estado:** 90% completo (código existe, falta activación)

❌ **Falta en producción:**
- [ ] WHATSAPP_PHONE_NUMBER_ID en Railway
- [ ] WHATSAPP_ACCESS_TOKEN en Railway
- [ ] Meta webhook URL configurada correctamente
- [ ] Webhook verification funcionando
- [ ] Testing end-to-end con número real
- [ ] n8n configurado para redireccionar webhooks

### 3. n8n (Automatizaciones)
**Estado:** Planeado

**Casos de uso:**
- Redirigir webhooks de Meta a Railway
- Enviar notificaciones por email cuando cliente agenda
- Recordatorios de cita 24h antes (SMS WhatsApp)
- Backup automático de datos
- Sincronizar datos entre sistemas externos

---

## Bugs Conocidos y TO-DO

### Chatbot WhatsApp
1. ❌ **Nombre del cliente no se actualiza bien**
   - Problema: A veces `client_name` = "Cliente WhatsApp" incluso cuando el cliente da su nombre
   - Ubicación: `chatbot.service.js::getOrCreateClient()`
   - Fix: Limpiar mejor la extracción de nombre en historial

2. ❌ **Disponibilidad con horarios complejos**
   - Problema: Puede mostrar horarios ocupados como libres si datos desactualizados
   - Ubicación: `utils/availability.js::getNextAvailableSlots()`
   - Fix: Validar más estrictamente contra appointments tabla

3. ❌ **Extracción de fecha con formato natural**
   - Problema: "el próximo lunes" no se parsea correctamente
   - Ubicación: `chatbot.service.js::processChatbotMessage()` → extract date
   - Fix: Usar librería `date-fns` o `day.js` para parsing natural

4. ⚠️ **Historial muy largo**
   - Si cliente tiene >10 mensajes, contextos viejos se pierden
   - Fix: Aumentar límite de historial a 20 o usar embeddings para relevancia

5. ⚠️ **Fidelización recién integrada (2026-05-19)**
   - Falta testing extensivo
   - Posible bugs en joins o cálculos de visitas

### Frontend

6. ❌ **Responsive móvil incompleto**
   - Solo login y sidebar están optimizados
   - Resto de pantallas falta agregar breakpoints
   - Ubicación: `pages/business/*.jsx`
   - Fix: Agregar md/sm/xs breakpoints a todas las tablas y modals

7. ❌ **Module filtering por business_type**
   - Sidebar muestra TODOS los módulos (barberia, spa, tienda)
   - Debe ocultar módulos según business_type
   - Ubicación: `components/ui/Sidebar.jsx::navItems`
   - Fix: Cargar business_type desde backend y filtrar navItems

8. ⚠️ **Performance en Analytics**
   - Heatmap puede ser lento con 1000+ appointments
   - Fix: Paginar o usar agregación en backend

### Backend

9. ❌ **Rate limiting muy restrictivo**
   - 1000 req/15min puede ser insuficiente
   - Fix: Ajustar según uso real en producción

10. ⚠️ **Logs no archivados**
    - Winston guarda en memoria
    - Fix: Agregar transporte a archivo o cloud (e.g. Papertrail)

### Base de Datos

11. ❌ **Bucket `product-images` no creado en Supabase Storage**
    - Ubicación: Supabase → Storage
    - Fix: Crear bucket, configurar RLS policies, activar public access

12. ⚠️ **Índices de performance**
    - product_variants tiene índices, pero falta en otras tablas
    - Ubicación: supabase/migrations/
    - Fix: Agregar índices en appointments.scheduled_at, clients.business_id, etc.

---

## Mejoras Futuras (Nice-to-Have)

### Funcionalidad

- [ ] **Reportes avanzados:** exportar PDF/Excel con gráficos
- [ ] **Facturación automática:** generar facturas DIAN (Colombia)
- [ ] **API pública:** permitir integraciones externas (webhooks, graphql)
- [ ] **Mobile app:** iOS + Android (React Native)
- [ ] **Notificaciones push:** browser + mobile
- [ ] **Videollamada:** Google Meet integrado para telemedicina (veterinaria)
- [ ] **Reservas con pago adelantado:** Wompi integrado
- [ ] **Categorías de clientes:** VIP, regular, inactivo
- [ ] **Templates de email:** notificaciones personalizadas

### Seguridad

- [ ] **2FA (Two-Factor Authentication):** TOTP (Google Authenticator)
- [ ] **Auditoría completa:** logs de todos los cambios
- [ ] **Encriptación end-to-end:** para mensajes sensibles
- [ ] **PCI DSS:** si manejamos tarjetas directamente
- [ ] **GDPR compliance:** si clientes europeos

### Performance

- [ ] **Caché con Redis:** datos frecuentes
- [ ] **CDN para imágenes:** Cloudinary o similar
- [ ] **Compresión de imágenes:** automática al upload
- [ ] **Lazy loading:** tablas con virtualization
- [ ] **Code splitting:** por ruta en frontend

### DevOps

- [ ] **Monitoring:** Sentry, Datadog, NewRelic
- [ ] **Alertas:** PagerDuty para oncall
- [ ] **CI/CD mejorado:** GitHub Actions tests + deploy
- [ ] **Blue-green deployment:** Railway
- [ ] **Staging environment:** para testing previo a producción

---

## Próximos Pasos Críticos (Prioridad)

### Semana 1-2 (CRÍTICO)
1. ✅ Crear bucket `product-images` en Supabase Storage
2. ✅ Ejecutar migración 021_product_sales_variant
3. **Activar ANTHROPIC_API_KEY en Railway**
4. **Activar WHATSAPP_* variables en Railway**
5. Testing end-to-end del chatbot con número real

### Semana 3-4 (IMPORTANTE)
6. Implementar Wompi para pagos
7. Agregar responsive móvil en resto de pantallas
8. Arreglar bugs conocidos del chatbot (nombre cliente, disponibilidad)
9. Testing de fidelización extensivo

### Semana 5-6 (PROYECTO)
10. Completar módulo TIENDA (carrito + checkout)
11. Módulo de PEDIDOS (order management)
12. Integración con n8n
13. README técnico para portafolio

---

## Métricas de Salud Actual

| Métrica | Estado | Acción |
|---------|--------|--------|
| Backend endpoints | ✅ 100% | N/A |
| Frontend páginas | ✅ 100% | Mejorar responsive |
| Autenticación | ✅ Funcional | N/A |
| Chatbot básico | ✅ Funcional | Arreglar bugs |
| Pago integrado | ❌ Falta | Implementar Wompi |
| Responsive móvil | ⚠️ 20% | Completar |
| Documentación | ⚠️ 40% | Agregar README |
| Testing | ❌ 0% | Agregar tests |

---

## Deploy Checklist

**Antes de marcar como "Producción Lista":**

- [ ] ANTHROPIC_API_KEY activo en Railway
- [ ] WHATSAPP_* variables configuradas
- [ ] Bucket product-images creado en Supabase
- [ ] Migraciones 020 y 021 ejecutadas
- [ ] Testing chatbot end-to-end (✅ de verdad)
- [ ] Responsive móvil en Dashboard (mínimo)
- [ ] Sentry configurado para error tracking
- [ ] Rate limiting ajustado (no demasiado restrictivo)
- [ ] Logs con transporte a file/cloud
- [ ] Email de notificaciones configurado
- [ ] Backup automático de Supabase
- [ ] DNS personalizado (si aplica)
- [ ] SSL certificado (Railway maneja automático)

---

## Contacto y Escalamiento

**Bugs críticos en producción:**
1. Verificar Railway logs: `railway logs --service=zita-production`
2. Revisar Supabase logs
3. Email al superadmin: esteban.zita.ia@gmail.com
4. GitHub issue con detalles

**Feature requests:**
- Documentar en `/docs` → actualizar CLAUDE.md
- Crear GitHub issue con especificación
- Asignar prioridad en roadmap

**Seguridad:**
- NUNCA commitear `.env` o secrets
- Cambiar ENCRYPT_SECRET regularmente
- Rotar WHATSAPP_ACCESS_TOKEN cada 30 días
- Auditar RLS policies mensualmente
