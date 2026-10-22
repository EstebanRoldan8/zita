// ============================================================================
// FUENTE ÚNICA DE CONTENIDO DE LA TIENDA FLOW
// Ningún componente tiene textos de colección escritos adentro: todo sale de aquí.
// Lo que no exista = null y la sección/línea se OCULTA (no inventar datos).
//
// Para cambiar de temporada: agregar un objeto a `collections` y cambiar `activeCollection`.
// ============================================================================

// Bicolor ("negro/azul"): punto partido en dos mitades con el hex de cada parte. Es un valor de
// `background`; isLightColor() no lo reconoce como hex y le pone el borde sutil.
const bicolor = (a, b) => `linear-gradient(90deg, ${a} 50%, ${b} 50%)`;

// Nombre de color normalizado (minúsculas, sin tildes, trim) → hex (o gradiente si es bicolor).
// Color desconocido => círculo stone con borde + tooltip con el nombre (nunca rompe).
export const colorMap = {
  negro: '#1C1C1C',
  azul: '#1F3A8A',
  'azul noche': '#19212C',
  'azul rey': '#1D3FA8',
  'vino tinto': '#5C1923',
  merlot: '#5C1923',
  rojo: '#B3202A',
  beige: '#D8C6A8',
  arena: '#D9CFC3',
  nude: '#D2B8A3',
  'verde rocio': '#BFDB95',
  'verde limon': '#C8E04A',
  gris: '#9A9CA0',
  'cool grey': '#9A9CA0',
  lavanda: '#AE9BB7',
  lavander: '#AE9BB7',
  blanco: '#FFFFFF',
  verde: '#5E8C5A',
  'verde oliva': '#6B6B3A',
  'azul claro': '#8DB6DD',
  cafe: '#6B4A36',
  amarillo: '#E8C547',
  'negro viejo': '#2B2B2B',
};
colorMap['negro/azul'] = bicolor(colorMap.negro, colorMap.azul);
colorMap['negro/gris'] = bicolor(colorMap.negro, colorMap.gris);

// ── Colección RENACER (textos tomados tal cual de la presentación de la colección) ──
const RENACER = {
  slug: 'renacer',
  name: 'RENACER',
  label: 'Colección RENACER',
  eyebrow: 'Nueva colección',
  intro: 'RENACER representa el nuevo capítulo de FLOW.',
  // Categorías extra que no son de esta colección (además de las de archive)
  excludeCategories: [],
  hero: {
    title: 'RENACER',
    subtitle: 'Hubo pausas. Hoy volvemos.',
    cta1: 'Comprar la colección',
    cta2: 'Comprar por color',
    image: null, // TODO: foto de campaña. Con null se usa composición tipográfica sobre sand.
    // Video vertical de fondo (frontend/public/video/): H.264 sin audio ~720 px y una portada WebP del inicio.
    // Sin src el hero queda como antes (imagen o composición sobre sand).
    video: { src: '/video/hero-renacer.mp4', poster: '/video/hero-renacer-poster.webp' },
  },
  // Bloques editoriales en orden. `accent` = palabra que va en color stone.
  storytelling: [
    {
      lines: ['FLOW nace para empoderar a las personas a través del movimiento y ayudarlas a conectar con su esencia y su “FLOW”.'],
      accent: 'FLOW”.',
      accentLast: true,
    },
    {
      lines: [
        'Si la marca nació como energía, rebeldía y movimiento consciente. RENACER es esa energía después del proceso.',
        'Más madura. Más estructurada. Más firme.',
      ],
    },
    {
      lines: [
        'RENACER representa el nuevo capítulo de FLOW.',
        'No es un comienzo desde cero, sino un regreso consciente después de pausas, aprendizajes y crecimiento.',
        'Esta colección nace desde la emoción, la honestidad y la decisión de hacerlo diferente.',
      ],
    },
    {
      lines: ['No se trata de cambiar quién eres. Se trata de volver más fuerte, más consciente y más alineado.'],
      list: ['Volver después de una pausa', 'Superar una etapa', 'Subir el nivel', 'Elegirte con más claridad'],
    },
    {
      quote: true,
      lines: ['Hubo pausas, crecimiento, aprendizajes… y hoy volvemos con intención.'],
      accent: 'intención',
    },
    {
      lines: ['FLOW renace porque nosotras también estamos renaciendo. Y esta colección es el reflejo de ese proceso: movimiento, intención y evolución.'],
    },
  ],
  values: ['Empoderamiento', 'Valentía', 'Calidad', 'Versatilidad', 'Simplicidad'],
  // Toda la colección sale completa el mismo día: las cápsulas son solo agrupaciones narrativas.
  capsules: [
    {
      slug: 'esencial',
      name: 'ESENCIAL',
      tagline: 'Volver a la raíz',
      text: [
        'ESENCIAL representa el regreso a la raíz de FLOW. Una cápsula que reintroduce sus pilares con intención renovada, desde la emoción, la calma y la autenticidad.',
        'Después de las pausas. Después del ruido. Después de la desconexión. Antes de expandirte, vuelves a la raíz. ESENCIAL representa ese momento silencioso donde decides empezar otra vez.',
      ],
      palette: { bg: 'linear-gradient(160deg, #0B0B10 0%, #12163A 100%)', solid: '#12163A', fg: '#D9CFC3' },
      colors: ['negro', 'azul'],
    },
    {
      slug: 'volver',
      name: 'VOLVER',
      tagline: 'Reconexión y decisión',
      text: [
        'FLOW vuelve no solo a su esencia, sino a una versión más amplia y segura.',
        'Este es el momento donde ya no dudas tanto. Todavía no estás “en tu mejor versión”. Pero ya estás caminando. Aquí es donde tú volviste a entrenar. Volviste a creer. Volviste a sentirte fuerte.',
      ],
      palette: { bg: 'linear-gradient(160deg, #5C1923 0%, #A09486 100%)', solid: '#5C1923', fg: '#D9CFC3' },
      colors: ['vino tinto', 'rojo', 'beige', 'arena', 'nude'],
    },
    {
      slug: 'florecer',
      name: 'FLORECER',
      tagline: 'Expansión visible',
      text: [
        'La expansión visible del renacer. FLOW florece con conciencia, energía y luz.',
        'Esta es la consecuencia natural del proceso. FLORECER no es perfección. Es seguridad. Es cuando ya no estás intentando. Estás siendo.',
      ],
      palette: { bg: 'linear-gradient(160deg, #6E5F7E 0%, #4F6B4A 100%)', solid: '#4F6B4A', fg: '#D9CFC3' },
      colors: ['verde rocio', 'verde limon', 'gris', 'cool grey', 'lavanda', 'lavander', 'blanco'],
    },
  ],
  // "Comprar por color"
  drops: [
    {
      slug: 'noir', name: 'NOIR DROP', capsule: 'esencial', colors: ['negro', 'negro viejo', 'negro/gris'],
      tagline: 'Volver a la raíz', description: 'El negro de siempre, con intención renovada.',
      protagonist: 'Set Aria', palette: { bg: '#1C1C1C', fg: '#D9CFC3' },
    },
    {
      slug: 'deep-blue', name: 'DEEP BLUE DROP', capsule: 'esencial', colors: ['azul', 'azul noche', 'azul rey', 'azul claro', 'negro/azul'],
      tagline: 'Volver a la raíz', description: 'Calma profunda para empezar otra vez.',
      protagonist: 'Set Aria y Pantaloneta azul', palette: { bg: '#19212C', fg: '#D9CFC3' },
    },
    {
      slug: 'merlot', name: 'MERLOT DROP', capsule: 'volver', colors: ['vino tinto', 'merlot', 'rojo'],
      tagline: 'Reconexión y decisión', description: 'Volviste a creer. Volviste a sentirte fuerte.',
      protagonist: 'Set Jana', palette: { bg: '#5C1923', fg: '#D9CFC3' },
    },
    {
      slug: 'sand', name: 'SAND DROP', capsule: 'volver', colors: ['beige', 'arena', 'nude'],
      tagline: 'Reconexión y decisión', description: 'Tonos tierra para una versión más segura.',
      protagonist: null, palette: { bg: '#D9CFC3', fg: '#1C1C1C' },
    },
    {
      slug: 'dew', name: 'DEW DROP', capsule: 'florecer', colors: ['verde rocio', 'verde limon', 'gris', 'cool grey', 'verde'],
      tagline: 'Expansión visible', description: 'Energía y luz que se dejan ver.',
      protagonist: 'Faldas', palette: { bg: '#BFDB95', fg: '#1C1C1C' },
    },
    {
      slug: 'lavander', name: 'LAVANDER DROP', capsule: 'florecer', colors: ['lavanda', 'lavander', 'blanco'],
      tagline: 'Expansión visible', description: 'No es perfección. Es seguridad.',
      protagonist: 'Faldas', palette: { bg: '#AE9BB7', fg: '#1C1C1C' },
    },
  ],
  // Jerarquía para destacar (coincidencia por "includes" normalizado sobre el nombre del producto).
  // Se usa SOLO para el bloque "Producto protagonista" y el orden sugerido en la colección.
  products: {
    icon: 'aria',
    disruptive: ['falda lira', 'falda vela'],
    expansion: ['oversize'],
    essential: ['jana', 'nila', 'pantaloneta'],
  },
};

export const flowContent = {
  brand: {
    name: 'FLOW',
    slogan: 'Just go with the flow',
    whatsapp: null, // sale de store_settings.whatsapp_number
    instagram: null, // sale de store_settings.social.instagram si existe
    email: 'flowactivewear.co@gmail.com', // correo de contacto: footer, Ayuda (Contacto) y datos de la organización (SEO)
    city: null,
  },
  // Título de la home para buscadores y previews (≤ 60 caracteres). El resto sale de lib/seo.js.
  seo: {
    homeTitle: 'FLOW | Ropa deportiva y lifestyle — Colección RENACER',
  },
  // Mensajes rotativos de la barra superior. Los que dependen de store_settings
  // (envío gratis desde $X) se construyen en runtime y se omiten si no hay dato.
  announcement: ['Nueva colección RENACER ya disponible', 'Envíos a toda Colombia'],
  activeCollection: 'renacer',
  collections: [RENACER],
  archive: {
    categoryMatch: ['flow archive', 'archive', 'archivo'],
    title: 'FLOW ARCHIVE',
    text: 'RENACER es capítulo nuevo. El stock viejo es archivo.',
  },
  // Orden de categorías; las demás van después en orden alfabético y Archive siempre al final
  // Sets primero (tipo propio: productos con is_bundle)
  categoryOrder: ['Sets', 'Tops', 'Licras', 'Shorts', 'Faldas', 'Pantalonetas', 'Camisetas'],
  // Secciones del menú: páginas /coleccion/<slug> con un grupo fijo de categorías (por nombre de
  // categoría, nunca por nombre de producto). Una sección sin productos no aparece.
  sections: [
    { slug: 'mujer', label: 'Mujer', categories: ['Tops', 'Licras', 'Shorts', 'Faldas', 'Pantalonetas'] },
    { slug: 'hombre', label: 'Hombre', categories: ['Hombre'] },
  ],
  // Categorías de la base que son GÉNERO, no tipo de prenda: nunca salen como categoría ni filtro.
  // Sus productos van en "Ver todo" bajo su tipo de prenda (collections.productType / garmentOf).
  genderCategories: ['Mujer', 'Hombre', 'Unisex'],
  // Género compartido: sus productos aparecen en TODAS las secciones (Mujer y Hombre), con su tipo de prenda
  unisexCategories: ['Unisex'],
  values: ['Empoderamiento', 'Valentía', 'Calidad', 'Versatilidad', 'Simplicidad'],
  about: `FLOW nace para empoderar a las personas a través del movimiento y ayudarlas a conectar con su esencia y su "FLOW".

Nacimos como energía, rebeldía y movimiento consciente. Hubo pausas, crecimiento y aprendizajes. Hoy volvemos con intención.

RENACER es el nuevo capítulo de FLOW. No es un comienzo desde cero, sino un regreso consciente. Esta colección nace desde la emoción, la honestidad y la decisión de hacerlo diferente.

No se trata de cambiar quién eres. Se trata de volver más fuerte, más consciente y más alineado.

Ropa deportiva y de lifestyle diseñada para acompañarte antes, durante y después de entrenar. Prendas simples, cómodas y versátiles para que te muevas a tu ritmo.`,
  faq: [
    { q: '¿Cómo hago mi pedido?', a: 'Eliges tus prendas, color y talla, las agregas a la bolsa y finalizas el pedido con tus datos de envío.\nDespués te escribimos por WhatsApp para confirmar el pedido y coordinar el pago.' },
    { q: '¿Las prendas de RENACER se repiten?', a: 'Cada color es un drop. Cuando una talla o un color se agota, puede no volver a estar disponible.\nSi quieres enterarte primero de lo que viene, únete a Flow Club por WhatsApp.' },
    { q: '¿Cómo puedo cambiar una prenda?', a: 'Escríbenos por WhatsApp con tu número de pedido y te ayudamos. Las condiciones están en la sección de Cambios y devoluciones.' },
  ],
  shipping: null, // TODO: texto de envíos (si es null se usa store_settings.policies.envios)
  returns: null, // TODO: texto de cambios (si es null se usa store_settings.policies.cambios)
  // Guía de tallas (página /guia-de-tallas, footer, Ayuda y ficha de producto). Una tabla por tipo de prenda:
  // `types` son los tipos de prenda de la tienda a los que aplica (Licras, Shorts…); la ficha muestra el enlace
  // solo si el producto (o algún componente de un set) es de uno de esos tipos. Medidas en cm.
  sizeGuide: {
    title: 'Guía de tallas',
    intro: null,
    tables: [
      {
        title: 'Licras',
        types: ['Licras'],
        columns: ['Talla', 'Cintura', 'Cadera', 'Largo total'],
        rows: [
          ['S', '68–76', '88–95', '95'],
          ['M', '74–80', '94–105', '105'],
          ['L', '76–86', '98–116', '107'],
        ],
      },
      {
        title: 'Shorts',
        types: ['Shorts'],
        columns: ['Talla', 'Cintura', 'Cadera', 'Largo total'],
        rows: [
          ['S', '68–76', '88–95', '33'],
          ['M', '74–80', '94–105', '35'],
          ['L', '76–86', '98–116', '40'],
        ],
      },
    ],
    note: 'Medidas en centímetros. Si estás entre dos tallas, escríbenos y te ayudamos a elegir.',
  },
  legal: { terms: null, privacy: null, returns: null },
  // Pasos de "¿Primera vez en FLOW?" (flujo real de la tienda)
  firstTime: [
    'Elige tu color y talla',
    'Confirma tu pedido',
    'Te escribimos por WhatsApp para coordinar el pago y el envío',
  ],
  // Video de la página Sobre FLOW (YouTube Short vertical, junto al texto de presentación). youtubeId: solo
  // el ID (youtube.com/shorts/<ID>); vacío = la página va sin video, en una columna. cover: portada vertical
  // en frontend/public/video/ (720 px de ancho, WebP, máx ~100 KB). No se carga nada de YouTube hasta el play.
  aboutVideo: {
    youtubeId: 'H7r7j6YAyGg',
    cover: '/video/flow-sobre.webp',
    coverAlt: 'Portada del video sobre FLOW',
    playLabel: 'Ver video sobre Flow',
    iframeTitle: 'Video sobre FLOW',
  },
  // Reels de Instagram de la portada (dentro de la banda Flow Club), en orden: el primero es el que más se ve.
  // code: el código del reel tal cual (instagram.com/reel/<code>/), con mayúsculas y minúsculas.
  // cover: portada opcional en frontend/public/reels/ (720x1280, WebP o JPG, máx ~150 KB), p. ej.
  // '/reels/Dep0av0pkja.webp'. Sin cover sale una tarjeta oscura con "Ver reel". title: opcional.
  instagram: {
    handle: '@flow.col',
    url: 'https://www.instagram.com/flow.col/',
    reels: [
      { code: 'Dep0av0pkja', title: null, cover: '/reels/Dep0av0pkja.webp' },
      { code: 'DehQauGxGWf', title: null, cover: '/reels/DehQauGxGWf.webp' },
      { code: 'DeXCI9mx_Cd', title: null, cover: '/reels/DeXCI9mx_Cd.webp' },
      { code: 'DOMbMbwiVjk', title: null, cover: '/reels/DOMbMbwiVjk.webp' },
      { code: 'DI_neNLNKm9', title: null, cover: '/reels/DI_neNLNKm9.webp' },
      { code: 'DIXJx0FSDFG', title: null, cover: '/reels/DIXJx0FSDFG.webp' },
    ],
  },
  club: {
    title: 'Flow Club',
    text: 'Entérate primero de lo que viene',
    whatsappMessage: 'Hola FLOW, quiero unirme al Flow Club y enterarme primero de lo que viene.',
  },
};
