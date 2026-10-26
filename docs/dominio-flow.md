# Dominio propio de la tienda FLOW: www.flowactivewear.co

El apex `flowactivewear.co` redirige a `www` desde Vercel. El dominio nuevo sirve la tienda FLOW en la raíz y es el
dominio canónico; `zita-alpha.vercel.app/tienda/flow` sigue funcionando pero su canonical apunta al dominio nuevo.
El panel, el login y la landing de ZITA no cambian.

## Qué cambia en el código

- `frontend/vercel.json`: redirección 308 `/tienda/flow/...` → `/...` y reglas de bots para las páginas legales y de
  ayuda en la raíz. Ambas llevan condición de host `www.flowactivewear.co`, así que `/terminos` y `/privacidad` de ZITA
  quedan como están.
- `frontend/api/_lib/store.js` y `store-prerender.js`: canonical y og:url del dominio propio sin prefijo, también para
  las páginas pedidas desde otro host.
- `frontend/src/store/hooks/useSeo.js`: lo mismo en la SPA (canonical, og:url y JSON-LD).
- Sin cambios en el backend: CORS ya lee `STORE_ALLOWED_ORIGINS`, y solo aplica a `/api/store/*`.

## Variables (las cambia el dueño; el código no las toca)

**Vercel** (proyecto del frontend; `Production` y `Preview` si se quiere probar con el preview):

| Variable | Valor |
|---|---|
| `VITE_STORE_HOST` | `www.flowactivewear.co` (solo host, sin `https://` ni barra) |
| `VITE_STORE_HOST_SLUG` | `flow` |
| `SITE_URL` | `https://www.flowactivewear.co` |
| `STORE_SLUG` | `flow` (si no existe) |
| `STORE_API_URL` | la URL pública del backend (si no existe) |

`VITE_*` se leen en el build: hay que **redesplegar** después de cambiarlas.

**Railway** (backend):

| Variable | Valor |
|---|---|
| `STORE_ALLOWED_ORIGINS` | `https://www.flowactivewear.co,https://flowactivewear.co` (más los que ya tenga, separados por comas) |

## Orden de despliegue

1. Railway: agregar los dos orígenes a `STORE_ALLOWED_ORIGINS` (no rompe nada; solo permite más orígenes).
2. Vercel: confirmar que `www.flowactivewear.co` está asignado al proyecto y el apex redirige a `www`.
3. Probar con el **preview** de este PR (ver abajo) antes del merge.
4. Merge del PR → Vercel despliega `main`.
5. Vercel: definir `VITE_STORE_HOST`, `VITE_STORE_HOST_SLUG` y `SITE_URL` y **redesplegar** (sin esto el sitio sigue
   como hoy: el código nuevo no cambia nada si `VITE_STORE_HOST` no está definida).
6. Verificar en producción y enviar `https://www.flowactivewear.co/sitemap.xml` a Search Console.

## Cómo probar con el preview de Vercel antes del merge

El preview vive en un host distinto (`*.vercel.app`), así que el dominio propio no responde ahí. Dos opciones:

- En el preview, definir `VITE_STORE_HOST` con el host del propio preview (sin `https://`) y `VITE_STORE_HOST_SLUG=flow`,
  y redesplegar el preview: ese host se comporta como el dominio propio (raíz = tienda, políticas en la raíz,
  `sitemap.xml` y `robots.txt`). La condición de host de `vercel.json` (`www.flowactivewear.co`) no aplica en el preview:
  las reglas de bots de la raíz y la redirección solo se pueden probar en el dominio real.
- Asignar un dominio de prueba al preview.

Comprobar: `/` muestra la tienda; `/terminos`, `/privacidad`, `/cambios` abren; ningún enlace interno lleva
`/tienda/flow`; `/sitemap.xml` y `/robots.txt` listan URLs del dominio; el canonical (ver código fuente) apunta al
dominio; el panel y `/login` siguen igual en `zita-alpha.vercel.app`.

## Limitación conocida

La raíz `/` la sirve el `index.html` estático (gana a cualquier rewrite de `vercel.json`), así que los bots y las
previews de WhatsApp/Instagram reciben el `<head>` de ZITA en `https://www.flowactivewear.co/`. Las demás rutas sí pasan
por el prerender. Arreglo posible: Routing Middleware de Vercel (queda como tarea aparte).

## Cómo revertir

- Rápido, sin código: quitar `VITE_STORE_HOST`, `VITE_STORE_HOST_SLUG` y `SITE_URL` en Vercel y redesplegar. El host
  nuevo deja de servir la tienda y `/tienda/flow` recupera su canonical propio.
- Código: revertir el commit de este PR (`git revert`). No hay migraciones ni cambios de datos.
