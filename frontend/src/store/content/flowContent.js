// ============================================================================
// FUENTE ÚNICA DE CONTENIDO DE LA TIENDA FLOW
// Ningún componente tiene textos de colección escritos adentro: todo sale de aquí.
// Lo que no exista = null y la sección/línea se OCULTA (no inventar datos).
//
// Para cambiar de temporada: agregar un objeto a `collections` y cambiar `activeCollection`.
// ============================================================================

// Nombre de color normalizado (minúsculas, sin tildes, trim) → hex.
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
};

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
    title: 'FLOW RENACE',
    subtitle: 'Hubo pausas. Hoy volvemos.',
    cta1: 'Comprar la colección',
    cta2: 'Comprar por color',
    image: null, // TODO: foto de campaña. Con null se usa composición tipográfica sobre sand.
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
      slug: 'noir', name: 'NOIR DROP', capsule: 'esencial', colors: ['negro'],
      tagline: 'Volver a la raíz', description: 'El negro de siempre, con intención renovada.',
      protagonist: 'Set Aria', palette: { bg: '#1C1C1C', fg: '#D9CFC3' },
    },
    {
      slug: 'deep-blue', name: 'DEEP BLUE DROP', capsule: 'esencial', colors: ['azul', 'azul noche', 'azul rey'],
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
      protagonist: 'Pantaloneta (beige y rojo)', palette: { bg: '#D9CFC3', fg: '#1C1C1C' },
    },
    {
      slug: 'dew', name: 'DEW DROP', capsule: 'florecer', colors: ['verde rocio', 'verde limon', 'gris', 'cool grey'],
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
    essential: ['jana', 'nila', 'liva', 'pantaloneta'],
  },
};

export const flowContent = {
  brand: {
    name: 'FLOW',
    slogan: 'Just go with the flow',
    whatsapp: null, // sale de store_settings.whatsapp_number
    instagram: null, // sale de store_settings.social.instagram si existe
    email: null,
    city: null,
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
  categoryOrder: ['Sets mujer', 'Hombre', 'Lifestyle', 'Básicos'],
  values: ['Empoderamiento', 'Valentía', 'Calidad', 'Versatilidad', 'Simplicidad'],
  about: null, // TODO: texto "Sobre FLOW" completo
  faq: [], // TODO: [{ q, a }]
  shipping: null, // TODO: texto de envíos (si es null se usa store_settings.policies.envios)
  returns: null, // TODO: texto de cambios (si es null se usa store_settings.policies.cambios)
  sizeGuide: null, // TODO: { title, intro?, columns: [...], rows: [[...]] }
  legal: { terms: null, privacy: null, returns: null },
  // Pasos de "¿Primera vez en FLOW?" (flujo real de la tienda)
  firstTime: [
    'Elige tu color y talla',
    'Confirma tu pedido',
    'Te escribimos por WhatsApp para coordinar el pago y el envío',
  ],
  club: {
    title: 'Flow Club',
    text: 'Entérate primero de lo que viene',
    whatsappMessage: 'Hola FLOW, quiero unirme al Flow Club y enterarme primero de lo que viene.',
  },
};
