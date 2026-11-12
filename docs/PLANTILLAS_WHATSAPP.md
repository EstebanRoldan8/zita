# Plantillas de WhatsApp (ventana de 24 h)

WhatsApp solo deja mandar **texto libre** a alguien que le escribió a ese número en las **últimas 24 horas**. Fuera de esa ventana Meta acepta la petición, pero después descarta el mensaje (estado `failed`, error **131047**) y nunca llega. Para escribir fuera de la ventana hay que usar una **plantilla aprobada**.

## Cómo lo resuelve el backend

`backend/src/services/whatsappNotify.js` → `notify()`:

| Situación | Qué sale |
|---|---|
| El destinatario escribió hace menos de 23 h 50 min | Texto libre (igual que antes) |
| Fuera de la ventana y `WA_TEMPLATES_ENABLED=true` | La plantilla de la tabla de abajo |
| Fuera de la ventana y plantillas apagadas | Texto libre como antes + aviso `[WA_FUERA_DE_VENTANA_SIN_PLANTILLA]` en el log |

La ventana se calcula con el último mensaje del destinatario guardado en `whatsapp_conversations`.

**Para activarlo:**
1. Crear las plantillas en Meta (WhatsApp Manager → Plantillas de mensajes) **en la cuenta de WhatsApp Business de cada negocio** que tenga número propio. Las plantillas viven en la WABA: si varios números comparten WABA, basta una vez. Las de ZITA (`aviso_fin_prueba`, `pago_rechazado`) van en la WABA del número global de ZITA.
2. Esperar la aprobación.
3. Poner `WA_TEMPLATES_ENABLED=true` en Railway (y `WA_TEMPLATE_LANG` si el idioma aprobado no es `es`, por ejemplo `es_CO`).

Si un negocio no tiene las plantillas aprobadas y se activa la variable, el envío falla con un error de Meta (código 132001, plantilla no existe). Queda en el log y en `system_alerts` para los recordatorios.

## Plantillas a crear

Idioma: **Español (es)**. Los `{{n}}` son variables; el backend las llena en ese orden. Los textos son una propuesta: se pueden ajustar mientras se respeten el número y el orden de las variables.

### 1. `recordatorio_cita` (Utilidad) — al cliente, 2 h antes de la cita
Desde el número del negocio.

> Hola {{1}} 👋 Te recordamos tu cita en *{{2}}* hoy a las *{{3}}* para *{{4}}*. ¿Nos confirmas?

Botones de **respuesta rápida** (en este orden):
| # | Texto | Payload que espera el backend |
|---|---|---|
| 1 | Confirmo | `CONFIRMAR_CITA` |
| 2 | Cancelar | `CANCELAR_CITA` |

Variables: `{{1}}` nombre del cliente (o "Hola"), `{{2}}` negocio, `{{3}}` hora, `{{4}}` servicio.
El botón llega al webhook como `type: 'button'` con ese payload, y se trata igual que responder "sí" / "no" al recordatorio (solo sobre esa cita).
Nota: Meta solo deja definir el payload de los botones al enviar; el backend lo manda en cada envío (no hay que configurarlo en la plantilla).

### 2. `aviso_nueva_cita` (Utilidad) — al dueño, cuando el bot agenda
> 📅 Nueva cita por WhatsApp. Cliente: {{1}} ({{2}}). Servicio: {{3}}. Fecha y hora: {{4}}. Precio: {{5}}.

### 3. `aviso_escalamiento` (Utilidad) — al dueño, cuando un cliente pide hablar con una persona
> ⚠️ Atención requerida en {{1}}: tu cliente {{2}} ({{3}}) quiere hablar contigo. Motivo: {{4}}. Escríbele directamente por WhatsApp.

`{{4}}` lo redacta el bot y se recorta a 200 caracteres.

### 4. `resumen_diario` (Utilidad) — al dueño, 7:00 a. m.
> 🗓️ Buenos días. Hoy tienes {{1}} citas: {{2}}. Total estimado: {{3}}.

`{{2}}` es una sola línea: `09:00 a. m. Corte · 10:30 a. m. Barba …` (Meta no acepta saltos de línea en variables).

### 5. `plan_vencido` (Utilidad) — al dueño, cuando un cliente escribe con el plan vencido (máx. 1 cada 24 h)
> ⚠️ El plan ZITA de {{1}} expiró y un cliente te está escribiendo por WhatsApp. Renueva para seguir atendiendo.

### 6. `aviso_fin_prueba` (Utilidad) — al dueño, desde el número de ZITA, 3 días antes de terminar la prueba
> Hola {{1}}, tu período de prueba en ZITA termina en 3 días. Renueva tu plan para seguir atendiendo clientes sin interrupciones: https://app.zita.co/dashboard/suscripcion

### 7. `pago_rechazado` (Utilidad) — al dueño, desde el número de ZITA
> Tu pago de {{1}} en ZITA no pudo procesarse. {{2}} Intenta de nuevo desde Suscripción: https://app.zita.co/dashboard/suscripcion

### 8. `te_extranamos` (Marketing) — a clientes que no vienen hace 30-90 días (herramienta del asistente)
> Hola {{1}} 👋 Hace rato no te vemos en {{2}}. ¡Te esperamos! Responde este mensaje para agendar tu próxima cita.

Es **Marketing** (Meta lo clasifica así y cobra la tarifa de marketing). El mensaje personalizado del negocio (`recall_message`) solo se usa dentro de la ventana de 24 h.

## Envíos que NO pasan por plantilla (y está bien)
- Las respuestas del bot al cliente: siempre son respuesta a un mensaje que acaba de llegar (dentro de la ventana).
- Los mensajes de error/límite del bot: idem.

## Pendiente (fuera del alcance de este cambio)
Estos envíos del **panel** siguen como texto libre y pueden no llegar fuera de la ventana:
- `controllers/appointments.controller.js` (aviso al cliente desde el panel; además usa el número global, sin token del negocio).
- `controllers/clients.controller.js`, `controllers/employees.controller.js` (aviso de reasignación), `controllers/store.controller.js` (aviso de pedido al dueño).
Se pueden migrar con el mismo `notify()` cuando se definan sus plantillas.
