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

## Identidad de FLOW (favicon, manifest, vista previa en la raíz)

- **Íconos:** `frontend/public/flow/` (favicon.ico, 16 y 32 px, apple-touch-icon 180, íconos 192 y 512, versiones
  maskable y `manifest.webmanifest` con nombre FLOW y `#1C1C1C`). Salen de la marca de barras inclinadas en blanco
  sobre `#1C1C1C`, cuadrados y con margen.
- **SPA (`main.jsx` → `store/lib/identity.js`):** en contexto de tienda (ruta `/tienda` o host propio) cambia en el
  `<head>` el favicon, el apple-touch-icon, el manifest, el theme-color y el nombre de la app por los de FLOW. ZITA no pasa por ahí.
- **Service worker:** el registro del PWA de ZITA ahora va inline en `index.html` (el mismo código que generaba
  vite-plugin-pwa, con `injectRegister: false`) y **no se ejecuta en el host propio** (`VITE_STORE_HOST`). Si ese host ya
  tuviera uno registrado, la SPA lo desregistra (solo los de ese origen y solo las cachés `workbox-*`/`zita-*`).
  `public/flow/` queda fuera del precaché de ZITA (`globIgnores`).
- **Prerender (`api/_lib/html.js`):** el `<head>` de las páginas de la tienda trae los íconos, el manifest y el
  theme-color de FLOW (Google toma el favicon del HTML).
- **Routing Middleware (`frontend/middleware.js`):** la raíz `/` la sirve el `index.html` estático, que gana a
  `vercel.json`. El middleware corre antes de los archivos estáticos y, **solo** si el host es `www.flowactivewear.co`,
  el método es GET/HEAD, la ruta es `/` y el user-agent es de un bot o previsualizador (la misma lista de `vercel.json`),
  reescribe a `/api/store-prerender?path=/`. Para cualquier otro host, persona, ruta o error: `next()`, sin tocar nada.
  Usa `@vercel/functions` (`next`, `rewrite`), runtime Node.js por defecto, `config.matcher = '/'`.
  A las personas no se les da el prerender: su contenido se vería un instante antes de que cargue la SPA.

### Comprobar en producción tras el merge

1. Pestaña de `https://www.flowactivewear.co`: favicon de FLOW (si sigue el viejo, recargar sin caché; los navegadores cachean favicons).
2. Vista previa de la raíz (debe decir FLOW, con `og-flow.jpg`):
   - `curl -s -A "WhatsApp/2.23.20.0" -H "Accept: text/html" https://www.flowactivewear.co/ | grep -E "<title>|og:title|og:image|rel=\"icon\"|canonical"`
   - `curl -s -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" https://www.flowactivewear.co/ | grep -E "<title>|canonical|manifest"`
   - Depurador de Facebook/Meta para enlaces (Sharing Debugger) con `https://www.flowactivewear.co/`, y Search Console → Inspección de URL.
3. Con un user-agent de persona, la raíz debe ser el HTML de siempre: `curl -s -A "Mozilla/5.0" https://www.flowactivewear.co/ | grep -c "<h1"` → 0 (el `#root` llega vacío y la SPA lo llena).
4. ZITA intacto: `curl -s -A "WhatsApp/2.23.20.0" https://zita-alpha.vercel.app/ | grep "<title>"` sigue diciendo ZITA; login, landing y panel cargan; la PWA de ZITA se sigue instalando.
5. En el preview del PR (host `*.vercel.app`) el middleware es no-op: la raíz debe cargar la landing de ZITA como siempre
   (eso confirma que el middleware carga bien en Vercel). Su comportamiento real solo se ve en el dominio propio.

### Riesgos

- El middleware **no se puede probar en Vercel antes del merge**: el preview no tiene el host `www.flowactivewear.co`.
  Se probó en local con un servidor que lo emula y con pruebas `node:test`. Si el archivo fallara al cargar, afectaría las
  peticiones a `/` de todos los hosts (también la landing de ZITA); por eso el primer paso tras el merge es comprobar la
  raíz de ZITA y de FLOW, y la reversa es borrar `frontend/middleware.js`.
- El archivo debe estar en la raíz del proyecto de Vercel (`frontend/` si ese es su Root Directory). Si el Root Directory
  fuera la raíz del repo, el middleware no se aplicaría (no rompe nada, simplemente no actúa) y habría que moverlo.
- El prerender debe recibir el host `www.flowactivewear.co` tras la reescritura. Si recibiera el del despliegue, devuelve el
  HTML base de siempre (mismo resultado que hoy): falla hacia lo seguro.
- Cada petición a `/` (también de ZITA) pasa por una invocación del middleware: latencia y costo mínimos.
- Dependencia nueva (`@vercel/functions`) y cambio del registro del service worker (inline en vez de `registerSW.js`):
  mismo código y mismo resultado para ZITA, comprobado en Chromium y WebKit (queda 1 registro en ZITA y ninguno en el host de la tienda).
- Los íconos salen de la imagen base que entregó el dueño; a 16 px la marca se ve pequeña pero reconocible.

## Cómo revertir

- Rápido, sin código: quitar `VITE_STORE_HOST`, `VITE_STORE_HOST_SLUG` y `SITE_URL` en Vercel y redesplegar. El host
  nuevo deja de servir la tienda y `/tienda/flow` recupera su canonical propio.
- Middleware: borrar `frontend/middleware.js` (y, si se quiere, la dependencia `@vercel/functions`) y redesplegar.
- Código: revertir el commit de este PR (`git revert`). No hay migraciones ni cambios de datos.
