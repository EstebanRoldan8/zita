// Etiquetas y formatos compartidos por los componentes de inventario

export const MOVEMENT_TYPE_LABELS = {
  inicial: 'Inventario inicial',
  entrada: 'Entrada',
  venta: 'Venta',
  ajuste: 'Ajuste',
  devolucion: 'Devolución',
  merma: 'Merma',
};

export const REFERENCE_LABELS = {
  restock: 'Entrada de mercancía',
  order: 'Pedido',
  order_cancel: 'Pedido cancelado',
  order_delete: 'Pedido eliminado',
  product_sale: 'Venta en el panel',
  product_create: 'Creación del producto',
  product_update: 'Edición del producto',
  variant_create: 'Creación de variante',
  variant_update: 'Edición de variante',
  manual: 'Saldo inicial',
};

export function variantLabel(attributes) {
  return Object.entries(attributes || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

export function formatDateTimeCO(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// Clases de modal: pantalla completa en móvil, centrado en md+ (igual que los modales existentes)
export const MODAL_OVERLAY = 'fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:px-4 md:py-4';
export const MODAL_PANEL = 'bg-[#131929] border border-violet-500/25 w-full h-[100dvh] md:h-auto md:max-h-[calc(100vh-2rem)] md:rounded-2xl shadow-2xl shadow-black/50 flex flex-col';
export const INPUT_CLS = 'w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 transition';
