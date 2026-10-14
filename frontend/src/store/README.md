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
| `/tienda/:slug/coleccion` | Tienda completa (`?categoria=`, `?color=`, `?talla=`, `?q=`, `?orden=`) |
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
  lib/specs.js          lee líneas "Tela: …", "Cuidado: …" de la descripción del producto
  lib/copy.js           textos de interfaz (botones, estados)
  lib/fonts.js          carga de fuentes solo en la tienda (incluye Cormorant para nombres de colección)
  hooks/                useStore, useCatalog, useStoreNav, useReveal, cartContext, useBagValidation, useDocumentMeta
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

## TODO

- [ ] **Fuente del slogan:** reemplazar "Mrs Saint Delafield" por **Autography** (`--flow-script` en `flow.css` y `lib/fonts.js`).
- [ ] **Fotografía:** hero/campaña (hoy un placeholder CSS con sombra de palmera), fotos por color de cada producto, Sobre FLOW.
- [ ] **Contenido pendiente en `flowContent.js`:** `about`, `faq`, `shipping`, `returns`, `sizeGuide`, `legal`, `brand.instagram`, `brand.email`, `brand.city`. Mientras sean null, sus secciones y enlaces no se muestran.
- [ ] **WhatsApp:** número en `store_settings` (sin él no aparecen el botón flotante ni los enlaces de WhatsApp).
- [ ] **Necesita backend:** fecha de creación del producto ("Nuevo" por fecha), orden por popularidad/ventas, orden por precio en el servidor.
- [ ] **Open Graph:** las páginas definen `og:*` en tiempo de ejecución (`useDocumentMeta`); para bots sin JS hace falta prerender o un `index.html` propio en el dominio de la tienda.
- [ ] **Favicon** de Flow para el dominio propio.
