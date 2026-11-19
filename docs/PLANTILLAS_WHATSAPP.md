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
3. Poner `WA_TEMPLATES_ENABLED=true` en Railway, y `WA_TPL_FIN_PRUEBA` / `WA_TPL_PAGO_RECHAZADO` con los nombres aprobados (ver tabla).

Si un negocio no tiene las plantillas aprobadas y se activa la variable, el envío falla con un error de Meta (código 132001, plantilla no existe). Queda en el log y en `system_alerts` para los recordatorios.

## Nombre e idioma de cada plantilla (como quedaron aprobadas en Meta)

Se configuran en **un solo lugar**: `TEMPLATE_CONFIG` en `backend/src/services/whatsappNotify.js`. El código de idioma tiene que ser **exactamente** el de Meta; si no, Meta responde 132001 y el mensaje no sale.

| Clave | Nombre en Meta | Variable para el nombre | Idioma (código) |
|---|---|---|---|
| `recordatorio_cita` | `recordatorio_cita` | `WA_TPL_RECORDATORIO` (opcional) | Spanish (COL) — `es_CO` |
| `aviso_nueva_cita` | `aviso_nueva_cita` | `WA_TPL_NUEVA_CITA` (opcional) | Spanish — **`es`** |
| `aviso_escalamiento` | `aviso_escalamiento` | `WA_TPL_ESCALAMIENTO` (opcional) | Spanish (COL) — `es_CO` |
| `resumen_diario` | `resumen_diario` | `WA_TPL_RESUMEN` (opcional) | Spanish (COL) — `es_CO` |
| `plan_vencido` | `plan_vencido` | `WA_TPL_PLAN_VENCIDO` (opcional) | Spanish (COL) — `es_CO` |
| `aviso_fin_prueba` | el de la variable (p. ej. `aviso_fin_prueba_v2`) | **`WA_TPL_FIN_PRUEBA` (obligatoria)** | Spanish (COL) — `es_CO` |
| `pago_rechazado` | el de la variable (p. ej. `pago_rechazado_v2`) | **`WA_TPL_PAGO_RECHAZADO` (obligatoria)** | Spanish (COL) — `es_CO` |
| `te_extranamos` | `te_extranamos` | `WA_TPL_TE_EXTRANAMOS` (opcional) | Spanish (COL) — `es_CO` |
| `aviso_cita_cancelada` | `aviso_cita_cancelada` | `WA_TPL_CITA_CANCELADA` (opcional) | Spanish (COL) — `es_CO` |

- `WA_TEMPLATE_LANG` ya **no** cambia el idioma de estas 8 (el idioma va por plantilla en el mapa). Solo aplica a una plantilla que no esté en el mapa.
- **Falla segura:** con `WA_TEMPLATES_ENABLED=true` y sin `WA_TPL_FIN_PRUEBA` o `WA_TPL_PAGO_RECHAZADO`, no se intenta la plantilla: queda `[WA_PLANTILLA_SIN_NOMBRE]` en el log (con el nombre de la variable que falta) y se manda texto libre, sin cortar el flujo. Fuera de la ventana ese texto probablemente no llegue: hay que poner la variable.
- Si se aprueba una plantilla en otro idioma, se cambia solo su `lang` en el mapa.

## Plantillas a crear

Idioma: el de la tabla de arriba. Los `{{n}}` son variables; el backend las llena en ese orden. Los textos son una propuesta: se pueden ajustar mientras se respeten el número y el orden de las variables.

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

### Número desde el que salen las plantillas 6 y 7 (de ZITA a sus clientes)
Con `WA_PLATFORM_PHONE_NUMBER_ID` **y** `WA_PLATFORM_ACCESS_TOKEN` definidas (solo en `.env` / Railway), `aviso_fin_prueba` y `pago_rechazado` salen de ese número (`platformSender()` en `services/businessSender.js`). Si no están las dos, salen como antes, con `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` (el número del bot); si solo hay una, queda `[WA_PLATAFORMA_INCOMPLETA]` en el log y tampoco se mezclan. Las plantillas tienen que estar aprobadas en la WABA de ese número.

### 6. `aviso_fin_prueba` (Utilidad) — al dueño, desde el número de ZITA, 3 días antes de terminar la prueba
> Hola {{1}}, tu período de prueba en ZITA termina en 3 días. Renueva tu plan para seguir atendiendo clientes sin interrupciones: https://app.zita.co/dashboard/suscripcion

### 7. `pago_rechazado` (Utilidad) — al dueño, desde el número de ZITA
> Tu pago de {{1}} en ZITA no pudo procesarse. {{2}} Intenta de nuevo desde Suscripción: https://app.zita.co/dashboard/suscripcion

### 8. `te_extranamos` (Marketing) — a clientes que no vienen hace 30-90 días (herramienta del asistente)
> Hola {{1}} 👋 Hace rato no te vemos en {{2}}. ¡Te esperamos! Responde este mensaje para agendar tu próxima cita.

Es **Marketing** (Meta lo clasifica así y cobra la tarifa de marketing). El mensaje personalizado del negocio (`recall_message`) solo se usa dentro de la ventana de 24 h.

### 9. `aviso_cita_cancelada` (Utilidad, es_CO) — al cliente, cuando el negocio cancela su cita
Desde el número del negocio.

> Hola {{1}}, tu cita de {{2}} del {{3}} fue cancelada por {{4}}. Si quieres reagendar, escríbenos por aquí.

Variables (exactamente 4): `{{1}}` nombre del cliente (máx. 60), `{{2}}` servicio (80), `{{3}}` fecha y hora como en el mensaje de texto, es-CO, hora de Colombia: "miércoles, 12 de noviembre a las 03:00 p. m." (60), `{{4}}` nombre del negocio (80).

## Variables de plantilla: saneo

Antes de enviar, cada variable pasa por `templateParam` (`utils/templateParam.js`): cualquier salto de línea, tabulación o secuencia de espacios se vuelve un solo espacio, se quitan caracteres de control, se corta al largo máximo de esa variable (con "…") y un valor vacío se manda como `-` (Meta rechaza variables vacías). Las plantillas con `vars` en `TEMPLATE_CONFIG` exigen exactamente ese número de variables: si un envío trae otro número, no se intenta la plantilla (Meta respondería 132000), sale texto libre y queda `[WA_PLANTILLA_VARIABLES]` en el log.

## Envíos que NO pasan por plantilla (y está bien)
- Las respuestas del bot al cliente: siempre son respuesta a un mensaje que acaba de llegar (dentro de la ventana).
- Los mensajes de error/límite del bot: idem.

## Avisos que inicia el panel

Todos pasan por `notify()` y salen del **número del negocio con su token** (`services/businessSender.js`; si el negocio no tiene `whatsapp_phone_number_id` o no tiene token, no sale nada y queda el log `WA_SIN_NUMERO`; nunca se usa otro número, regla S3).

| Aviso | Dónde | Dentro de la ventana | Fuera de la ventana |
|---|---|---|---|
| Recordatorio manual a un cliente (Clientes → Recordar) | `clients.controller.js` | Mensaje personalizado del negocio | Plantilla `te_extranamos` |
| Cita cancelada por el negocio (panel, barbero, asistente) | `services/cancellationNotice.js` | Texto | Plantilla `aviso_cita_cancelada` |
| Cita reasignada al eliminar un empleado | `employees.controller.js` (`notifyReassignment`) | Texto | **Sin plantilla aprobada**: texto + aviso (kind `cita_reasignada`) |
| Pedido web, al dueño | `store.controller.js` (`notifyOwnerNow`) | Texto | **Sin plantilla aprobada**: texto + aviso (kind `pedido_web`) |

**Para cerrar el hueco** hay que crear en Meta (Utilidad, es_CO) plantillas para estos tres avisos —por ejemplo `cita_cancelada` ({{1}} servicio, {{2}} fecha y hora), `cita_reasignada` ({{1}} servicio, {{2}} fecha y hora, {{3}} empleado) y `nuevo_pedido_web` ({{1}} código, {{2}} cliente, {{3}} total)— y agregarlas a `TEMPLATE_CONFIG`. Mientras tanto se mandan como texto (no se omiten: la ventana se calcula con el historial, y cancelar borra el historial; omitirlos podría silenciar avisos que sí llegarían). La etiqueta del log dice cuántos quedaron fuera de la ventana.
