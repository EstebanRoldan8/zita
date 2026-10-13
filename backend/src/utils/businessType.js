// Misma normalización que frontend/src/lib/businessType.js: business_type llega como
// 'Tienda', 'tienda', etc. en la base.
function isTiendaBusiness(business) {
  return (business?.business_type || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') === 'tienda';
}

module.exports = { isTiendaBusiness };
