const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const INCOME_CATEGORIES = ['servicios', 'productos', 'otro'];
const EXPENSE_CATEGORIES = ['nomina', 'materias_primas', 'servicios', 'arriendo', 'otro'];

function dateToString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function periodRange(query) {
  // Accept ?month=YYYY-MM (preferred) or ?period=day|week|month (legacy)
  if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
    const [yr, mo] = query.month.split('-').map(Number);
    const start = `${query.month}-01`;
    const end = dateToString(new Date(yr, mo, 0));
    return { start, end };
  }

  const period = query.period || 'month';
  let now = new Date();

  if (period === 'day') {
    if (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
      return { start: query.date, end: query.date };
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    return { start: today, end: today };
  }

  if (period === 'week') {
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + daysToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: dateToString(monday),
      end: dateToString(sunday),
    };
  }

  const year = now.getFullYear();
  const month = now.getMonth();
  return {
    start: dateToString(new Date(year, month, 1)),
    end: dateToString(new Date(year, month + 1, 0)),
  };
}

function fmtCOP(v) {
  return `$${new Intl.NumberFormat('es-CO').format(Math.round(v ?? 0))}`;
}

// ──────────────────────────────────────────
// GET /api/cash/summary?period=day|week|month
// ──────────────────────────────────────────
async function getSummary(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { start, end } = periodRange(req.query);

    // Last 6 months for chart
    const chartFrom = new Date();
    chartFrom.setMonth(chartFrom.getMonth() - 5);
    chartFrom.setDate(1);
    const chartStart = chartFrom.toISOString().slice(0, 10);

    // Convert dates to ISO timestamps (UTC): start at 00:00, end at next day 00:00
    const startTS = `${start}T00:00:00-05:00`;
    const endTS = `${end}T23:59:59-05:00`;
    const chartStartTS = `${chartStart}T00:00:00Z`;

    const [
      { data: periodIncome },
      { data: periodAppts },
      { data: periodExpenses },
      { data: chartIncome },
      { data: chartExpenses },
      { data: chartAppts },
    ] = await Promise.all([
      userClient.from('income').select('amount')
        .eq('business_id', req.businessId)
        .gte('date', start)
        .lte('date', end),
      userClient.from('appointments').select('price, scheduled_at')
        .eq('business_id', req.businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', startTS)
        .lt('scheduled_at', endTS),
      userClient.from('expenses').select('amount')
        .eq('business_id', req.businessId)
        .gte('date', start)
        .lte('date', end),
      userClient.from('income').select('amount, date')
        .eq('business_id', req.businessId)
        .gte('date', chartStart),
      userClient.from('expenses').select('amount, date')
        .eq('business_id', req.businessId)
        .gte('date', chartStart),
      userClient.from('appointments').select('price, scheduled_at')
        .eq('business_id', req.businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', chartStartTS),
    ]);

    const incomeTotal  = (periodIncome  || []).reduce((s, r) => s + Number(r.amount), 0)
                       + (periodAppts   || []).reduce((s, r) => s + Number(r.price || 0), 0);
    const expenseTotal = (periodExpenses|| []).reduce((s, r) => s + Number(r.amount), 0);

    // Build 6-month chart
    const chartMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      chartMap[key] = { month: key, income: 0, expenses: 0 };
    }
    for (const r of (chartIncome   || [])) { const k = r.date.slice(0, 7);         if (chartMap[k]) chartMap[k].income   += Number(r.amount); }
    for (const r of (chartAppts    || [])) { const k = r.scheduled_at.slice(0, 7); if (chartMap[k]) chartMap[k].income   += Number(r.price || 0); }
    for (const r of (chartExpenses || [])) { const k = r.date.slice(0, 7);         if (chartMap[k]) chartMap[k].expenses += Number(r.amount); }

    return res.json({
      success: true,
      data: {
        income_total:  incomeTotal,
        expense_total: expenseTotal,
        net:           incomeTotal - expenseTotal,
        chart_data:    Object.values(chartMap),
      },
    });
  } catch (err) {
    logger.error(`cash.getSummary: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// GET /api/cash/income?period=day|week|month
// ──────────────────────────────────────────
async function getIncome(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    let { start, end } = periodRange(req.query);

    const startTS = `${start}T00:00:00-05:00`;
    const endTS = `${end}T23:59:59-05:00`;

    const [
      { data: manual, error: incErr },
      { data: appts },
      { data: sales },
    ] = await Promise.all([
      userClient.from('income')
        .select('id, amount, category, description, custom_category, client_id, services_detail, source, date, created_at, clients(name)')
        .eq('business_id', req.businessId)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: false }),
      userClient.from('appointments')
        .select('id, price, scheduled_at, clients(name), services(name)')
        .eq('business_id', req.businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', startTS)
        .lt('scheduled_at', endTS),
      userClient.from('product_sales')
        .select('id, quantity, total_amount, created_at, products(name)')
        .eq('business_id', req.businessId)
        .gte('created_at', `${start}T00:00:00-05:00`)
        .lte('created_at', `${end}T23:59:59-05:00`)
        .order('created_at', { ascending: false }),
    ]);

    if (incErr) throw incErr;

    const apptRows = (appts || []).map((a) => ({
      id: a.id,
      amount: a.price || 0,
      category: 'servicios',
      description: a.services?.name || 'Servicio',
      custom_category: null,
      client_id: null,
      clients: a.clients,
      services_detail: null,
      source: 'appointment',
      appointment_id: a.id,
      date: a.scheduled_at.slice(0, 10),
      created_at: a.scheduled_at,
    }));

    const salesRows = (sales || []).map((s) => ({
      id: s.id,
      amount: s.total_amount || 0,
      category: 'productos',
      description: `${s.products?.name || 'Producto'} x${s.quantity}`,
      custom_category: null,
      client_id: null,
      clients: null,
      services_detail: null,
      source: 'product_sale',
      sale_id: s.id,
      date: s.created_at?.slice(0, 10),
      created_at: s.created_at,
    }));

    const combined = [...(manual || []), ...apptRows, ...salesRows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.json({ success: true, data: combined });
  } catch (err) {
    logger.error(`cash.getIncome: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// GET /api/cash/expenses?period=day|week|month
// ──────────────────────────────────────────
async function getExpenses(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { start, end } = periodRange(req.query);

    const { data, error } = await userClient
      .from('expenses')
      .select('id, amount, category, description, date, created_at')
      .eq('business_id', req.businessId)
      .gte('date', start).lte('date', end)
      .order('date', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error(`cash.getExpenses: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// POST /api/cash/income
// ──────────────────────────────────────────
async function createIncome(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { amount, category, description, custom_category, client_id, services_detail, date } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0)
      return res.status(400).json({ success: false, error: 'El monto debe ser un número positivo.' });
    if (!INCOME_CATEGORIES.includes(category))
      return res.status(400).json({ success: false, error: 'Categoría inválida.' });
    if (!date)
      return res.status(400).json({ success: false, error: 'La fecha es obligatoria.' });

    const { data, error } = await userClient.from('income').insert({
      business_id: req.businessId,
      amount: parseFloat(amount),
      category,
      description: description?.trim() || null,
      custom_category: category === 'otro' ? (custom_category?.trim() || null) : null,
      client_id: client_id || null,
      services_detail: services_detail?.trim() || null,
      source: 'manual',
      date,
    }).select().single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`cash.createIncome: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// PUT /api/cash/income/:id
// ──────────────────────────────────────────
async function updateIncome(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { amount, category, description, custom_category, client_id, services_detail, date } = req.body;

    if (amount !== undefined && (isNaN(amount) || Number(amount) <= 0))
      return res.status(400).json({ success: false, error: 'El monto debe ser un número positivo.' });
    if (category !== undefined && !INCOME_CATEGORIES.includes(category))
      return res.status(400).json({ success: false, error: 'Categoría inválida.' });

    const patch = {};
    if (amount      !== undefined) patch.amount          = parseFloat(amount);
    if (category    !== undefined) patch.category        = category;
    if (description !== undefined) patch.description     = description?.trim() || null;
    if (custom_category !== undefined) patch.custom_category = custom_category?.trim() || null;
    if (client_id   !== undefined) patch.client_id       = client_id || null;
    if (services_detail !== undefined) patch.services_detail = services_detail?.trim() || null;
    if (date        !== undefined) patch.date            = date;

    const { data, error } = await userClient.from('income').update(patch)
      .eq('id', id).eq('business_id', req.businessId).select().single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Ingreso no encontrado.' });
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`cash.updateIncome: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// DELETE /api/cash/income/:id
// ──────────────────────────────────────────
async function deleteIncome(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { error } = await userClient.from('income').delete()
      .eq('id', req.params.id).eq('business_id', req.businessId);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    logger.error(`cash.deleteIncome: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// POST /api/cash/expenses
// ──────────────────────────────────────────
async function createExpense(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { amount, category, description, date } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0)
      return res.status(400).json({ success: false, error: 'El monto debe ser un número positivo.' });
    if (!EXPENSE_CATEGORIES.includes(category))
      return res.status(400).json({ success: false, error: 'Categoría inválida.' });
    if (!date)
      return res.status(400).json({ success: false, error: 'La fecha es obligatoria.' });

    const { data, error } = await userClient.from('expenses').insert({
      business_id: req.businessId,
      amount: parseFloat(amount),
      category,
      description: description?.trim() || null,
      date,
    }).select().single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`cash.createExpense: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// PUT /api/cash/expenses/:id
// ──────────────────────────────────────────
async function updateExpense(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { amount, category, description, date } = req.body;

    if (amount !== undefined && (isNaN(amount) || Number(amount) <= 0))
      return res.status(400).json({ success: false, error: 'El monto debe ser un número positivo.' });
    if (category !== undefined && !EXPENSE_CATEGORIES.includes(category))
      return res.status(400).json({ success: false, error: 'Categoría inválida.' });

    const patch = {};
    if (amount      !== undefined) patch.amount      = parseFloat(amount);
    if (category    !== undefined) patch.category    = category;
    if (description !== undefined) patch.description = description?.trim() || null;
    if (date        !== undefined) patch.date        = date;

    const { data, error } = await userClient.from('expenses').update(patch)
      .eq('id', id).eq('business_id', req.businessId).select().single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Egreso no encontrado.' });
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`cash.updateExpense: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// DELETE /api/cash/expenses/:id
// ──────────────────────────────────────────
async function deleteExpense(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { error } = await userClient.from('expenses').delete()
      .eq('id', req.params.id).eq('business_id', req.businessId);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    logger.error(`cash.deleteExpense: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// GET /api/cash/report/monthly?month=2026-04
// ──────────────────────────────────────────
async function exportPdf(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = new Date(yr, mo, 0).toISOString().slice(0, 10);
    const startTS = `${start}T00:00:00-05:00`;
    const endTS = `${end}T23:59:59-05:00`;
    const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const monthLabel = `${MONTHS[mo-1]} ${yr}`;
    const today = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });

    const [{ data: incomeData }, { data: expenseData }, { data: apptData }, { data: biz }] = await Promise.all([
      userClient.from('income').select('amount,category,description,date,clients(name)').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('expenses').select('amount,category,description,date').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('appointments').select('price,scheduled_at,clients(name),services(name)').eq('business_id', req.businessId).eq('status', 'completed').gte('scheduled_at', startTS).lt('scheduled_at', endTS),
      userClient.from('businesses').select('name').eq('id', req.businessId).single(),
    ]);

    const allIncome = [
      ...(incomeData || []).map(r => ({ date: r.date, desc: r.description || r.category, client: r.clients?.name || '—', cat: r.category || 'servicios', amount: Number(r.amount) })),
      ...(apptData || []).filter(r => Number(r.price || 0) > 0).map(r => ({ date: r.scheduled_at.slice(0,10), desc: r.services?.name || 'Servicio', client: r.clients?.name || '—', cat: 'Servicios', amount: Number(r.price) })),
    ].sort((a,b) => a.date.localeCompare(b.date));

    const CAT_LABELS = { nomina:'Nómina', materias_primas:'Materias primas', servicios:'Servicios', arriendo:'Arriendo', otro:'Otro' };
    const allExpenses = (expenseData || []).map(r => ({ date: r.date, cat: CAT_LABELS[r.category] || r.category, desc: r.description || '—', amount: Number(r.amount) }));

    const incomeTotal = allIncome.reduce((s,r) => s + r.amount, 0);
    const expenseTotal = allExpenses.reduce((s,r) => s + r.amount, 0);
    const net = incomeTotal - expenseTotal;

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="libro-caja-${month}.pdf"`);
    doc.pipe(res);

    const PAGE_W = 595;
    const MARGIN = 40;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    const drawHeader = () => {
      doc.rect(0, 0, PAGE_W, 70).fill('#7c3aed');
      doc.fontSize(22).fillColor('#ffffff').font('Helvetica-Bold').text('ZITA', MARGIN, 18);
      doc.fontSize(11).fillColor('#e9d5ff').font('Helvetica').text('Libro de Caja', MARGIN, 44);
      doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold').text(biz?.name || 'Mi negocio', 0, 18, { align: 'right', width: PAGE_W - MARGIN });
      doc.fontSize(9).fillColor('#e9d5ff').font('Helvetica').text(`${monthLabel} · Generado: ${today}`, 0, 44, { align: 'right', width: PAGE_W - MARGIN });
      doc.y = 85;
    };

    const drawFooter = () => {
      doc.fontSize(7).fillColor('#94a3b8').font('Helvetica')
        .text('Documento generado por ZITA · No reemplaza documentos contables oficiales', MARGIN, doc.page.height - 25, { align: 'center', width: CONTENT_W });
    };

    const checkPage = (height = 15) => {
      if (doc.y + height > doc.page.height - 40) {
        drawFooter();
        doc.addPage({ margin: 0 });
        doc.y = 20;
      }
    };

    drawHeader();
    doc.y = 90;

    const sectionTitle = (title) => {
      checkPage(30);
      const ty = doc.y;
      doc.rect(MARGIN, ty, CONTENT_W, 24).fill('#7c3aed');
      doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold')
        .text(title, MARGIN + 8, ty + 6, { lineBreak: false });
      doc.y = ty + 30;
    };

    sectionTitle('Resumen Financiero');

    const summaryRows = [
      { label: 'Ingresos por servicios (citas)', amount: (apptData||[]).filter(r=>Number(r.price||0)>0).reduce((s,r)=>s+Number(r.price),0), color: '#059669' },
      { label: 'Ingresos manuales', amount: (incomeData||[]).reduce((s,r)=>s+Number(r.amount),0), color: '#059669' },
      { label: 'Total ingresos', amount: incomeTotal, color: '#059669', bold: true },
    ];

    const expBycat = {};
    allExpenses.forEach(r => { expBycat[r.cat] = (expBycat[r.cat]||0) + r.amount; });
    Object.entries(expBycat).forEach(([cat, amt]) => summaryRows.push({ label: `Egresos - ${cat}`, amount: amt, color: '#dc2626' }));
    summaryRows.push({ label: 'Total egresos', amount: expenseTotal, color: '#dc2626', bold: true });
    summaryRows.push({ label: 'Saldo neto del período', amount: net, color: net >= 0 ? '#059669' : '#dc2626', bold: true });

    summaryRows.forEach((row, i) => {
      const rowY = doc.y;
      const bg = i % 2 === 0 ? '#f1f5f9' : '#ffffff';
      doc.rect(MARGIN, rowY, CONTENT_W, 16).fill(bg);
      const font = row.bold ? 'Helvetica-Bold' : 'Helvetica';
      doc.fontSize(9).fillColor('#334155').font(font).text(row.label, MARGIN + 8, rowY + 3, { width: CONTENT_W - 100, lineBreak: false });
      doc.fillColor(row.color).font(font).text(fmtCOP(row.amount), MARGIN, rowY + 3, { width: CONTENT_W - 8, align: 'right' });
      doc.y = rowY + 16;
    });

    sectionTitle('Ingresos Detallados');

    const IC = { fecha: MARGIN, desc: MARGIN+70, cliente: MARGIN+270, cat: MARGIN+370, monto: MARGIN+450 };
    const headerIncomeY = doc.y;
    doc.rect(MARGIN, headerIncomeY, CONTENT_W, 16).fill('#e2e8f0');
    doc.fontSize(8).fillColor('#475569').font('Helvetica-Bold');
    doc.text('Fecha',      IC.fecha,   headerIncomeY+3, { width: 65,  lineBreak: false });
    doc.text('Descripción',IC.desc,    headerIncomeY+3, { width: 195, lineBreak: false });
    doc.text('Cliente',    IC.cliente, headerIncomeY+3, { width: 95,  lineBreak: false });
    doc.text('Categoría',  IC.cat,     headerIncomeY+3, { width: 75,  lineBreak: false });
    doc.text('Monto',      IC.monto,   headerIncomeY+3, { width: 65,  align: 'right' });
    doc.y = headerIncomeY + 16;

    allIncome.forEach((r, i) => {
      checkPage(16);
      const rowY = doc.y;
      const bg = i % 2 === 0 ? '#f1f5f9' : '#ffffff';
      doc.rect(MARGIN, rowY, CONTENT_W, 15).fill(bg);
      const catLabel = r.cat ? r.cat.charAt(0).toUpperCase() + r.cat.slice(1) : 'Otro';
      doc.fontSize(8).fillColor('#334155').font('Helvetica');
      doc.text(r.date,   IC.fecha,   rowY + 3, { width: 65,  lineBreak: false });
      doc.text(r.desc,   IC.desc,    rowY + 3, { width: 195, lineBreak: false });
      doc.text(r.client, IC.cliente, rowY + 3, { width: 95,  lineBreak: false });
      doc.text(catLabel, IC.cat,     rowY + 3, { width: 75,  lineBreak: false });
      doc.fillColor('#059669').text(fmtCOP(r.amount), IC.monto, rowY + 3, { width: 65, align: 'right', lineBreak: false });
      doc.y = rowY + 15;
    });

    const totalIncomeY = doc.y;
    doc.rect(MARGIN, totalIncomeY, CONTENT_W, 18).fill('#dcfce7');
    doc.fontSize(9).fillColor('#059669').font('Helvetica-Bold');
    doc.text('Total Ingresos', IC.fecha, totalIncomeY + 3, { width: 350, lineBreak: false });
    doc.text(fmtCOP(incomeTotal), IC.monto, totalIncomeY + 3, { width: 65, align: 'right' });
    doc.y = totalIncomeY + 18;

    doc.y += 20;
    sectionTitle('Egresos Detallados');

    const EC = { fecha: MARGIN, cat: MARGIN+70, desc: MARGIN+180, monto: MARGIN+450 };
    const headerExpenseY = doc.y;
    doc.rect(MARGIN, headerExpenseY, CONTENT_W, 16).fill('#e2e8f0');
    doc.fontSize(8).fillColor('#475569').font('Helvetica-Bold');
    doc.text('Fecha',     EC.fecha, headerExpenseY+3, { width: 65,  lineBreak: false });
    doc.text('Categoría', EC.cat,   headerExpenseY+3, { width: 105, lineBreak: false });
    doc.text('Descripción',EC.desc, headerExpenseY+3, { width: 265, lineBreak: false });
    doc.text('Monto',     EC.monto, headerExpenseY+3, { width: 65,  align: 'right' });
    doc.y = headerExpenseY + 16;

    allExpenses.forEach((r, i) => {
      checkPage(16);
      const rowY = doc.y;
      const bg = i % 2 === 0 ? '#f1f5f9' : '#ffffff';
      doc.rect(MARGIN, rowY, CONTENT_W, 15).fill(bg);
      doc.fontSize(8).fillColor('#334155').font('Helvetica');
      doc.text(r.date, EC.fecha, rowY + 3, { width: 65,  lineBreak: false });
      doc.text(r.cat,  EC.cat,   rowY + 3, { width: 105, lineBreak: false });
      doc.text(r.desc, EC.desc,  rowY + 3, { width: 265, lineBreak: false });
      doc.fillColor('#dc2626').text(fmtCOP(r.amount), EC.monto, rowY + 3, { width: 65, align: 'right', lineBreak: false });
      doc.y = rowY + 15;
    });

    const totalExpenseY = doc.y;
    doc.rect(MARGIN, totalExpenseY, CONTENT_W, 18).fill('#fee2e2');
    doc.fontSize(9).fillColor('#dc2626').font('Helvetica-Bold');
    doc.text('Total Egresos', EC.fecha, totalExpenseY + 3, { width: 350, lineBreak: false });
    doc.text(fmtCOP(expenseTotal), EC.monto, totalExpenseY + 3, { width: 65, align: 'right' });
    doc.y = totalExpenseY + 18;

    drawFooter();
    doc.end();

  } catch (err) {
    logger.error(`cash.exportPdf: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Error al generar el PDF.' });
  }
}

// ──────────────────────────────────────────
// GET /api/cash/report/excel?month=2026-04
// ──────────────────────────────────────────
async function getExcel(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = new Date(yr, mo, 0).toISOString().slice(0, 10);
    const startTS = `${start}T00:00:00-05:00`;
    const endTS = `${end}T23:59:59-05:00`;
    const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const monthLabel = `${MONTHS[mo - 1]} ${yr}`;
    const today = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });

    const [{ data: incomeData }, { data: expenseData }, { data: apptData }, { data: biz }] = await Promise.all([
      userClient.from('income').select('amount,category,description,date,clients(name)').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('expenses').select('amount,category,description,date').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('appointments').select('price,scheduled_at,clients(name),services(name)').eq('business_id', req.businessId).eq('status', 'completed').gte('scheduled_at', startTS).lt('scheduled_at', endTS),
      userClient.from('businesses').select('name').eq('id', req.businessId).single(),
    ]);

    const CAT = { nomina: 'Nómina', materias_primas: 'Materias primas', servicios: 'Servicios', arriendo: 'Arriendo', otro: 'Otro' };
    const allIncome = [
      ...(incomeData || []).map(r => ({ date: r.date, desc: r.description || r.category, client: r.clients?.name || '—', cat: r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Otro', source: 'Manual', amount: Number(r.amount) })),
      ...(apptData || []).filter(r => Number(r.price || 0) > 0).map(r => ({ date: r.scheduled_at.slice(0, 10), desc: r.services?.name || 'Servicio', client: r.clients?.name || '—', cat: 'Servicios', source: 'Cita', amount: Number(r.price) })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const allExpenses = (expenseData || []).map(r => ({ date: r.date, cat: CAT[r.category] || r.category, desc: r.description || '—', amount: Number(r.amount) }));
    const incomeTotal = allIncome.reduce((s, r) => s + r.amount, 0);
    const expenseTotal = allExpenses.reduce((s, r) => s + r.amount, 0);
    const net = incomeTotal - expenseTotal;

    const wb = new ExcelJS.Workbook();
    const VIOLET = 'FF7C3AED';
    const GREEN = 'FF059669';
    const RED = 'FFDC2626';
    const WHITE = 'FFFFFFFF';
    const LIGHT_GRAY = 'FFF1F5F9';

    const headerStyle = (color = VIOLET) => ({
      font: { bold: true, color: { argb: WHITE }, size: 10 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: color } },
      alignment: { vertical: 'middle', horizontal: 'center' },
      border: { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
    });

    const applyHeader = (row, color = VIOLET) => {
      row.eachCell(cell => Object.assign(cell, headerStyle(color)));
      row.height = 22;
    };

    // HOJA RESUMEN
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 35 }, { width: 20 }, { width: 15 }, { width: 15 }];
    const titleRow = ws1.addRow(['ZITA - Libro de Caja']);
    titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: VIOLET } };
    titleRow.height = 30;
    ws1.addRow([biz?.name || 'Mi negocio']).getCell(1).font = { bold: true, size: 12 };
    ws1.addRow([`${monthLabel} · Generado: ${today}`]).getCell(1).font = { color: { argb: 'FF64748B' } };
    ws1.addRow([]);
    const sh = ws1.addRow(['Concepto', 'Monto']);
    applyHeader(sh);

    let summaryRowIndex = 0;
    const addSummaryRow = (label, amount, color, bold = false) => {
      const r = ws1.addRow([label, amount]);
      if (summaryRowIndex % 2 === 0) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }; });
      r.getCell(1).font = { bold, size: 10 };
      r.getCell(2).font = { bold, color: { argb: color }, size: 10 };
      r.getCell(2).numFmt = '$#,##0';
      r.getCell(2).alignment = { horizontal: 'right' };
      summaryRowIndex++;
    };

    const apptIncome = (apptData || []).filter(r => Number(r.price || 0) > 0).reduce((s, r) => s + Number(r.price), 0);
    const manualIncome = (incomeData || []).reduce((s, r) => s + Number(r.amount), 0);
    addSummaryRow('Ingresos por servicios (citas)', apptIncome, GREEN);
    addSummaryRow('Ingresos manuales', manualIncome, GREEN);
    addSummaryRow('Total ingresos', incomeTotal, GREEN, true);
    ws1.addRow([]);
    summaryRowIndex++;
    const expByCat = {};
    allExpenses.forEach(r => { expByCat[r.cat] = (expByCat[r.cat] || 0) + r.amount; });
    Object.entries(expByCat).forEach(([cat, amt]) => addSummaryRow(`Egresos - ${cat}`, amt, RED));
    addSummaryRow('Total egresos', expenseTotal, RED, true);
    ws1.addRow([]);
    summaryRowIndex++;
    addSummaryRow('Saldo neto del período', net, net >= 0 ? GREEN : RED, true);

    // HOJA INGRESOS
    const ws2 = wb.addWorksheet('Ingresos');
    ws2.columns = [{ width: 14 }, { width: 35 }, { width: 22 }, { width: 14 }, { width: 10 }, { width: 14 }];
    const ih = ws2.addRow(['Fecha', 'Descripción', 'Cliente', 'Categoría', 'Fuente', 'Monto']);
    applyHeader(ih);
    allIncome.forEach((r, i) => {
      const row = ws2.addRow([r.date, r.desc, r.client, r.cat, r.source, r.amount]);
      if (i % 2 === 0) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }; });
      row.getCell(6).numFmt = '$#,##0';
      row.getCell(6).font = { color: { argb: GREEN } };
      row.getCell(6).alignment = { horizontal: 'right' };
    });
    const it = ws2.addRow(['', '', '', '', 'Total', incomeTotal]);
    it.getCell(5).font = { bold: true };
    it.getCell(6).font = { bold: true, color: { argb: GREEN } };
    it.getCell(6).numFmt = '$#,##0';

    // HOJA EGRESOS
    const ws3 = wb.addWorksheet('Egresos');
    ws3.columns = [{ width: 14 }, { width: 18 }, { width: 35 }, { width: 14 }];
    const eh = ws3.addRow(['Fecha', 'Categoría', 'Descripción', 'Monto']);
    applyHeader(eh);
    allExpenses.forEach((r, i) => {
      const row = ws3.addRow([r.date, r.cat, r.desc, r.amount]);
      if (i % 2 === 0) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }; });
      row.getCell(4).numFmt = '$#,##0';
      row.getCell(4).font = { color: { argb: RED } };
      row.getCell(4).alignment = { horizontal: 'right' };
    });
    const et = ws3.addRow(['', '', 'Total', expenseTotal]);
    et.getCell(3).font = { bold: true };
    et.getCell(4).font = { bold: true, color: { argb: RED } };
    et.getCell(4).numFmt = '$#,##0';

    // HOJA POR CATEGORÍA
    const ws4 = wb.addWorksheet('Por Categoría');
    ws4.columns = [{ width: 25 }, { width: 15 }];
    const ch = ws4.addRow(['Ingresos por Categoría', 'Total']);
    applyHeader(ch, GREEN);
    const incByCat = {};
    allIncome.forEach(r => { incByCat[r.cat] = (incByCat[r.cat] || 0) + r.amount; });
    Object.entries(incByCat).forEach(([cat, amt], i) => {
      const r = ws4.addRow([cat, amt]);
      if (i % 2 === 0) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }; });
      r.getCell(2).numFmt = '$#,##0';
      r.getCell(2).font = { color: { argb: GREEN } };
    });
    ws4.addRow([]);
    const ch2 = ws4.addRow(['Egresos por Categoría', 'Total']);
    applyHeader(ch2, RED);
    Object.entries(expByCat).forEach(([cat, amt], i) => {
      const r = ws4.addRow([cat, amt]);
      if (i % 2 === 0) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }; });
      r.getCell(2).numFmt = '$#,##0';
      r.getCell(2).font = { color: { argb: RED } };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="libro-caja-${month}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error(`cash.getExcel: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Error al generar el Excel.' });
  }
}

async function getProductsSold(req, res) {
  try {
    const businessId = req.businessId;

    console.log('req.business completo:', JSON.stringify(req.business));
    console.log('businessId resuelto:', businessId);

    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Business no encontrado' });
    }

    const { month } = req.query;

    const mesActual = new Date().toISOString().slice(0, 7);
    const mes = month || mesActual;
    const inicio = mes + '-01';
    const fin = mes + '-' + new Date(mes.slice(0,4), mes.slice(5,7), 0).getDate();

    const { data, error } = await supabaseAdmin
      .from('product_sales')
      .select('quantity, total_amount, created_at, products(name)')
      .eq('business_id', businessId)
      .gte('created_at', inicio + 'T00:00:00Z')
      .lte('created_at', fin + 'T23:59:59Z')
      .order('created_at', { ascending: false });

    console.log('mes:', mes, 'inicio:', inicio, 'fin:', fin, 'results:', data?.length);

    if (error) throw error;

    const agrupado = {};
    data?.forEach(s => {
      const nombre = s.products?.name || 'Sin nombre';
      if (!agrupado[nombre]) agrupado[nombre] = {
        nombre, unidades: 0, total: 0, ventas: []
      };
      agrupado[nombre].unidades += s.quantity;
      agrupado[nombre].total += s.total_amount;
      agrupado[nombre].ventas.push({
        fecha: s.created_at?.slice(0,10),
        cantidad: s.quantity,
        total: s.total_amount,
        canal: s.source || 'manual'
      });
    });

    const productos = Object.values(agrupado)
      .sort((a, b) => b.total - a.total);

    res.json({ success: true, data: productos });

  } catch (error) {
    console.log('ERROR products-sold:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getSummary, getIncome, getExpenses,
  createIncome, updateIncome, deleteIncome,
  createExpense, updateExpense, deleteExpense,
  exportPdf, getExcel, getProductsSold,
};
