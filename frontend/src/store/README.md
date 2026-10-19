# Tienda pública Flow (`src/store/`)

Tienda de la marca Flow dentro del frontend de ZITA. Consume la API pública
`/api/store/:slug` (`backend/src/controllers/store.controller.js`). No usa la sesión del panel.

## Cómo verla en local

1. Backend en `http://localhost:3000` con la tienda `tienda-test` activa (`_pruebas/setup-tienda-publica.sql`).
2. `frontend/.env`: `VITE_API_URL=http://localhost:3000`.
3. `cd frontend && npm run dev` → abre `http://localhost:5173/tienda/tienda-test`.
4. El backend local usa la base de PRODUCCIÓN: en pedidos de prueba el nombre debe terminar en `_BORRAR`.

## Rutas

| Ruta | Página |
|---|---|
| `/tienda/:slug` | Inicio |
| `/tienda/:slug/coleccion` | "Ver todo": TODO el catálogo. `?categoria=` es un tipo de prenda (`collections.productType`: Tops, Licras…, y para Hombre/Unisex el de `garmentOf`, p. ej. Pantalonetas); Mujer/Hombre/Unisex son género (`flowContent.genderCategories`) y nunca son categoría. `?categoria=Hombre` o `Mujer` redirige a su sección. También `?color=`, `?talla=`, `?q=`, `?orden=` |
| `/tienda/:slug/coleccion/mujer` · `/coleccion/hombre` | Secciones del menú (`flowContent.sections`): Tops, Licras, Shorts y Faldas · Hombre |
| `/tienda/:slug/coleccion/:collectionSlug` | Colección (RENACER; `?capsula=esencial\|volver\|florecer`) |
| `/tienda/:slug/colores` · `/colores/:dropSlug` | Comprar por color / drop |
| `/tienda/:slug/producto/:id?color=` | Producto (color preseleccionado por URL) |
| `/tienda/:slug/ayuda` | Ayuda: contacto, FAQ, guía de tallas, políticas (solo lo que exista) |
| `/tienda/:slug/sobre-flow` | Sobre FLOW (`/nosotros` redirige aquí) |
| `/tienda/:slug/bolsa` | Bolsa |
| `/tienda/:slug/checkout` | Finalizar pedido |
| `/tienda/:slug/pedido/:id?phone=` | Confirmación |
| `/tienda/:slug/envios` · `/cambios` · `/privacidad` · `/terminos` | Políticas (desde `store_settings.policies`) |

Las rutas viven fuera de `AuthProvider`, `ProtectedRoute`, `Layout`, `Sidebar` y `SubscriptionWarning`
(ver `src/App.jsx`). Todo se carga con `React.lazy`.

**Dominio propio:** si `VITE_STORE_HOST` y `VITE_STORE_HOST_SLUG` están definidos y `window.location.hostname`
coincide con `VITE_STORE_HOST`, la raíz `/` sirve la tienda de ese slug (rutas sin `/tienda/:slug`).
`vercel.json` ya reescribe cualquier ruta profunda a `index.html`.

## Estructura

```
store/
  StoreApp.jsx          carga la tienda por slug, contexto y rutas internas
  flow.css              tokens y clases flow-* (todo bajo .flow-store)
  lib/storeApi.js       axios propio SIN JWT ni redirect a login
  lib/format.js         COP, claves de atributos, teléfono, envío, idempotencia
  content/flowContent.js  FUENTE ÚNICA de contenido RENACER: textos, cápsulas, drops, colores, marca.
                        Lo que no exista va en null / [] y la sección se oculta.
  lib/collections.js    helpers puros: colores, cápsulas, drops, jerarquía, filtros
  lib/policies.js       políticas, FAQ y guía de tallas (store_settings > flowContent; sin textos inventados)
  lib/seo.js            SEO de cada página (compartido con frontend/api)
  lib/specs.js          lee líneas "Tela: …", "Cuidado: …" de la descripción del producto
  lib/copy.js           textos de interfaz (botones, estados)
  lib/fonts.js          carga de fuentes solo en la tienda (incluye Cormorant para nombres de colección)
  hooks/                useStore, useCatalog, useStoreNav, useReveal, cartContext, useBagValidation, useSeo
  components/           StoreLayout, StoreHeader, AnnouncementBar, SearchOverlay, StoreFooter, WhatsAppFab,
                        ProductCard, ProductCarousel, ProductListing, ColorDot, SizeGuideTable, BagDrawer, Logo…
  components/home/      secciones del inicio (hero, colección, por color, protagonista, historia, cápsulas…)
  pages/                Home, Collection, CollectionDetail, Colors, ProductPage, Help, SobreFlow, BagPage,
                        Checkout, Confirmation, Policy
  assets/logo/          logos oficiales optimizados (webp + png 900 px, negro y blanco)
  scripts/optimize-logo.mjs  regenera los logos desde el PNG original (sharp)
```

## Tokens de marca (Brand Book 2026)

Definidos como variables CSS en `.flow-store` (`flow.css`). El tema del panel no cambia.

| Token | Valor | Uso |
|---|---|---|
| `--flow-black` | `#1C1C1C` | texto, botones primarios, footer |
| `--flow-white` | `#FFFFFF` | fondo |
| `--flow-sand` | `#D9CFC3` | fondo cálido, skeletons |
| `--flow-stone` | `#A09486` | bordes, separadores 1px |
| `--flow-navy` | `#19212C` | bloques pequeños (White + Navy) |
| `--flow-merlot` | `#5C1923` | avisos, bloques (Sand + Merlot) |
| `--flow-rocio` | `#BFDB95` | chips (Stone + Rocío) |
| `--flow-lavender` | `#AE9BB7` | chips (Soft Black + Lavender) |

Base = black + white + sand + stone. Los colores de acento solo en bloques pequeños.
Texto secundario sobre blanco usa `.text-flow-muted` (`#6E655B`, un stone más oscuro para cumplir AA).

Clases: `bg-flow-*`, `text-flow-*`, `border-flow-*`, `flow-rule`, `flow-display` (títulos en mayúsculas con tracking),
`flow-serif`, `flow-label` (etiquetas 0.15em), `flow-script` (solo slogan), `flow-btn` + `flow-btn-primary|outline|light`,
`flow-input`, `flow-option` (radios accesibles con apariencia de botón), `flow-swatch`, `flow-photo` (4:5), `flow-skeleton`.

**Cambiar la paleta:** edita las variables al inicio de `flow.css`.
**Cambiar textos:** `lib/copy.js` (hero, slogan, valores, botones, políticas base).

## Contrato con la API

- Respuestas `{ success, data }`. El pedido envía solo `product_id`, `variant_id` y `quantity`: precios, envío y total los calcula el servidor.
- `idempotency_key` se genera una vez por intento y se reutiliza si el envío falla y se reintenta. Un 200 con `duplicate: true` es éxito.
- `409 { error: 'sin_stock', items }` → vuelve a la bolsa con aviso. 400 → mensaje del servidor.
- Métodos de pago enviados: `transferencia`, `nequi`, `efectivo` (el botón "Efectivo / contraentrega" envía `efectivo`). Nunca hay formulario de tarjeta.
- Honeypot: campo oculto `website`.
- La API ordena por lo más nuevo; el orden por precio se aplica a los productos ya cargados (no hay orden en el servidor).

## SEO

La SPA y las funciones de Vercel usan las mismas funciones puras de `lib/seo.js`, así lo que recibe un bot es lo
mismo que ve una persona (título, descripción, precio, fotos, disponibilidad). Nada se inventa.

- **Cliente:** `useSeo(...)` en cada página pone título, description, robots, canonical, Open Graph, Twitter y
  JSON-LD, y al salir de la tienda deja el `<head>` como estaba (el `index.html` es compartido con ZITA).
- **noindex:** bolsa, checkout, pedido, 404, búsqueda (`?q=`) y filtros combinados. El canonical de un listado
  filtrado apunta al listado sin filtros (la categoría sí es página: `/coleccion?categoria=X`).
- **JSON-LD:** Organization + WebSite (home), Product + BreadcrumbList (producto), BreadcrumbList (colección,
  categoría, drop). Sin reseñas ni ratings.
- **Funciones (`frontend/api/`):**
  - `store-sitemap.js` → `/sitemap.xml`: home, tienda, colección activa, colores/drops con productos, categorías
    con productos, ayuda, Sobre FLOW, políticas con texto y cada producto. Sin `lastmod` (la API no expone fechas).
    Si la API falla: 503 sin caché.
  - `store-robots.js` → `/robots.txt`: en el dominio de ZITA conserva sus reglas (antes `public/robots.txt`) y
    agrega las de `/tienda/*`; en el dominio propio, las reglas de la tienda en la raíz.
  - `store-prerender.js`: solo para user-agents de buscadores y redes (`vercel.json` → `has`). Devuelve el
    `index.html` de la build con el `<head>` SEO y el contenido de la página dentro de `#root` (React lo reemplaza
    al montar). Producto o tienda inexistente: 404 + noindex. API caída: HTML base con `<head>` de marca.
- **Variables en Vercel (solo servidor):** `STORE_API_URL`, `SITE_URL`, `STORE_SLUG`. Ver `frontend/.env.example`.
- **Imagen por defecto de los previews:** `public/og-flow.jpg` y `public/flow-logo.png` (`scripts/og-image.mjs`).
- **Pruebas locales:** `node _pruebas/seo/run.mjs` (API falsa, req/res simulados y simulación de los rewrites).

## TODO

- [ ] **Fuente del slogan:** reemplazar "Mrs Saint Delafield" por **Autography** (`--flow-script` en `flow.css` y `lib/fonts.js`).
- [ ] **Fotografía:** hero/campaña (hoy un placeholder CSS con sombra de palmera), fotos por color de cada producto, Sobre FLOW.
- [ ] **Contenido pendiente en `flowContent.js`:** `shipping`, `returns`, `sizeGuide`, `legal`, `brand.instagram`, `brand.email`, `brand.city`. Mientras sean null, sus secciones y enlaces no se muestran.
- [ ] **WhatsApp:** número en `store_settings` (sin él no aparecen el botón flotante ni los enlaces de WhatsApp).
- [ ] **Necesita backend:** fecha de creación del producto ("Nuevo" por fecha), orden por popularidad/ventas, orden por precio en el servidor.
- [ ] **Home en dominio propio para bots:** con `VITE_STORE_HOST`, la ruta `/` la sirve `index.html` (archivo estático, gana a cualquier rewrite), así que los bots reciben el `<head>` de ZITA en la raíz. Las demás rutas sí pasan por el prerender. Arreglo posible: Routing Middleware de Vercel.
- [ ] **Imagen de previews:** `public/og-flow.jpg` es el logo sobre sand; reemplazar por una foto de campaña de 1200 × 630.
- [ ] **Favicon** de Flow para el dominio propio.
