const router = require('express').Router();
const {
  getSummary, getIncome, getExpenses,
  createIncome, updateIncome, deleteIncome,
  createExpense, updateExpense, deleteExpense,
  exportPdf, getExcel, getProductsSold,
} = require('../controllers/cash.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { checkFeatureAccess } = require('../middlewares/featureCheck');

router.use(verifyToken, businessContext);

// 'reportes_pdf' es exclusiva de Estándar/Pro (ver backend/src/config/plans.js);
// el resto de /api/cash ya está protegido por 'caja' (Estándar/Pro) en app.js.
const requireReportesPdf = checkFeatureAccess('reportes_pdf');

router.get('/summary',         getSummary);
router.get('/products-sold',   getProductsSold);
router.get('/income',          getIncome);
router.get('/expenses',        getExpenses);
router.post('/income',        createIncome);
router.put('/income/:id',     updateIncome);
router.delete('/income/:id',  deleteIncome);
router.post('/expenses',      createExpense);
router.put('/expenses/:id',   updateExpense);
router.delete('/expenses/:id',deleteExpense);
router.get('/export/pdf',      requireReportesPdf, exportPdf);
router.get('/report/monthly',  requireReportesPdf, exportPdf);
router.get('/report/excel',    requireReportesPdf, getExcel);

module.exports = router;
