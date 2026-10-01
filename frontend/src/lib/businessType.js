// Misma normalización que Products.jsx usa para isTienda: business_type llega como
// 'Tienda', 'tienda', etc. en la base.
export function isTiendaBusiness(business) {
  return business?.business_type
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') === 'tienda';
}
