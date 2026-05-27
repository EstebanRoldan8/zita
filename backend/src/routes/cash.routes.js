const router = require('express').Router();
const {
  getSummary, getIncome, getExpenses,
  createIncome, updateIncome, deleteIncome,
  createExpense, updateExpense, deleteExpense,
  exportPdf, getExcel, getProductsSold,
} = require('../controllers/cash.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

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
router.get('/export/pdf',      exportPdf);
router.get('/report/monthly',  exportPdf);
router.get('/report/excel',    getExcel);

module.exports = router;
