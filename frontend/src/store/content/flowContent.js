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

// ÚNICO mapa de colores de la tienda (bolitas de tarjetas, ficha, carrusel, "Producto ícono", filtros y drops).
// Clave = nombre normalizado (minúsculas, sin tildes, guiones como espacio, trim) → hex real de la prenda en las fotos
// (o gradiente si es bicolor). Los alias van en la misma tabla. Un color fuera del mapa se ve como NEUTRAL_COLOR.
export const NEUTRAL_COLOR = '#B8B8B8';
export const colorMap = {
  negro: '#1C1C1C',
  'negro viejo': '#2B2B2B',
  blanco: '#FFFFFF',
  gris: '#A3A9AF',
  'cool grey': '#A3A9AF',
  azul: '#1E4C8A',
  'azul rey': '#1D3FA8',
  'azul noche': '#19212C',
  'azul claro': '#86A9D6',
  'azul cielo': '#A9D4EC',
  rojo: '#C62828',
  'vino tinto': '#6E1A2B',
  vino: '#6E1A2B',
  merlot: '#6E1A2B',
  beige: '#D6BE9F',
  arena: '#D9CFC3',
  nude: '#D2B8A3',
  cafe: '#A67B5B',
  verde: '#1F8A4C',
  'verde oliva': '#5F7457',
  'verde olivo': '#5F7457',
  'verde rocio': '#BFDB95',
  'verde limon': '#C8E04A',
  lavanda: '#C3AEE0',
  lavander: '#C3AEE0',
  lila: '#CDB4E3',
  rosa: '#F5BFB2',
  fucsia: '#DD4F78',
  naranja: '#F59A3C',
  amarillo: '#F3D54E',
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
  // Bloques editoriales en orden. `accent` = palabra que va en color stone (comillas incluidas, si las lleva).
  storytelling: [
    {
      lines: [
        'RENACER representa el nuevo capítulo de FLOW. No volvemos desde cero, volvemos con más claridad, fuerza e intención.',
        'Después de las pausas, los aprendizajes y el crecimiento, elegimos evolucionar sin perder nuestra esencia.',
      ],
    },
    {
      italic: true,
      lines: ['No se trata de ser alguien diferente, sino de volver más consciente, más fuerte y más fiel a quien eres.'],
    },
    {
      lines: ['FLOW renace porque nosotras también estamos renaciendo. Y esta colección es el reflejo de ese proceso.'],
    },
  ],
  // Foto de campaña junto al texto de RENACER (WebP 800/1200 px en public/flow/campana/)
  storyImage: {
    src: '/flow/campana/renacer-800.webp',
    srcSet: '/flow/campana/renacer-800.webp 800w, /flow/campana/renacer-1200.webp 1200w',
    width: 800,
    height: 1200,
    alt: 'Modelo de FLOW con top y licra azul noche sosteniendo una pelota de pilates frente a un muro color terracota',
  },
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
      photoPriority: ['negro', 'azul'], // color de la foto principal de cada tarjeta en la cápsula (en este orden)
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
      photoPriority: ['vino tinto', 'rojo', 'beige'],
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
      photoPriority: ['lavanda', 'verde'],
    },
  ],
  // "Comprar por color". defines = colores que DEFINEN el drop: un producto entra solo si tiene uno de ellos
  // (con alias). colors = todos los tonos del drop (orden de foto y portada); photoPriority = foto primero.
  // Las cápsulas son la unión de los `defines` de sus drops.
  drops: [
    {
      slug: 'noir', name: 'NOIR DROP', capsule: 'esencial', defines: ['negro'], colors: ['negro', 'negro viejo', 'negro/gris'],
      tagline: 'Volver a la raíz', description: 'El negro de siempre, con intención renovada.',
      protagonist: 'Set Aria', palette: { bg: '#1C1C1C', fg: '#D9CFC3' },
    },
    {
      slug: 'deep-blue', name: 'DEEP BLUE DROP', capsule: 'esencial', defines: ['azul'], colors: ['azul', 'azul noche', 'azul rey', 'azul claro', 'negro/azul'],
      tagline: 'Volver a la raíz', description: 'Calma profunda para empezar otra vez.',
      protagonist: 'Set Aria y Pantaloneta azul', palette: { bg: '#19212C', fg: '#D9CFC3' },
    },
    {
      slug: 'merlot', name: 'MERLOT DROP', capsule: 'volver', defines: ['vino tinto', 'rojo'], colors: ['vino tinto', 'merlot', 'rojo'],
      tagline: 'Reconexión y decisión', description: 'Volviste a creer. Volviste a sentirte fuerte.',
      protagonist: 'Set Jana', palette: { bg: '#5C1923', fg: '#D9CFC3' },
    },
    {
      slug: 'sand', name: 'SAND DROP', capsule: 'volver', defines: ['beige'], colors: ['beige', 'arena', 'nude'],
      tagline: 'Reconexión y decisión', description: 'Tonos tierra para una versión más segura.',
      protagonist: 'Pantaloneta (beige y rojo)', palette: { bg: '#D9CFC3', fg: '#1C1C1C' },
    },
    {
      slug: 'dew', name: 'DEW DROP', capsule: 'florecer', defines: ['verde'], colors: ['verde rocio', 'verde limon', 'gris', 'cool grey', 'verde'],
      photoPriority: ['verde', 'verde rocio', 'verde limon', 'gris'], // foto principal de las tarjetas del drop (en este orden)
      tagline: 'Expansión visible', description: 'Energía y luz que se dejan ver.',
      protagonist: 'Faldas', palette: { bg: '#BFDB95', fg: '#1C1C1C' },
    },
    {
      slug: 'lavander', name: 'LAVANDER DROP', capsule: 'florecer', defines: ['lavanda'], colors: ['lavanda', 'lavander', 'blanco'],
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
    // Línea oficial de WhatsApp: solo dígitos con indicativo (enlaces wa.me). Con número, los botones de
    // WhatsApp (header, banda Flow Club, footer, botón flotante, Ayuda) aparecen solos; null = store_settings.whatsapp_number
    whatsapp: '573174382899',
    whatsappDisplay: '317 438 2899', // cómo se ve el número en textos legales, footer y PQR
    instagram: 'https://www.instagram.com/flow.col/', // si store_settings.social.instagram existe, manda ese
    instagramHandle: '@flow.col',
    email: 'flowactivewear.co@gmail.com', // correo de contacto: footer, Ayuda (Contacto) y datos de la organización (SEO)
    city: null,
  },
  // Titular de la marca (Información del vendedor y textos legales). notificationAddress reemplaza
  // [DIRECCIÓN DE NOTIFICACIONES] del Word: PENDIENTE de confirmar con el abogado.
  seller: {
    legalName: 'LIZETH NATALIA LOPEZ PEREZ',
    nit: '1.144.052.790-7',
    matricula: '1220888',
    notificationAddress: 'Santiago de Cali; notificaciones al correo flowactivewear.co@gmail.com',
  },
  // Formulario de PQR (p. ej. Google Forms). Vacío = la sección PQR muestra solo WhatsApp y correo.
  pqrFormUrl: '',
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
    cta: 'Ver archivo', // enlace a la categoría del archivo (portada)
  },
  // Orden de categorías; las demás van después en orden alfabético y Archive siempre al final
  // Sets primero (tipo propio: productos con is_bundle)
  categoryOrder: ['Sets', 'Tops', 'Licras', 'Shorts', 'Faldas', 'Pantalonetas', 'Camisetas'],
  // Secciones del menú: páginas /coleccion/<slug> con un grupo fijo de categorías (por nombre de
  // categoría, nunca por nombre de producto). Una sección sin productos no aparece.
  sections: [
    { slug: 'mujer', label: 'Mujer', categories: ['Tops', 'Licras', 'Shorts', 'Faldas'] },
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
  // Textos legales: content/flowLegal.js (generado desde los Word aprobados). Aquí solo la fecha que muestran
  // las páginas cuyo Word no la trae escrita (Envíos y pagos, Preguntas frecuentes, Promociones).
  legal: { effectiveDate: '23 de octubre de 2026' },
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
