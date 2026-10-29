const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { getTimezone, getOffsetForTz, getDateByCountry } = require('../utils/timezone');

const INCOME_CATEGORIES = ['servicios', 'productos', 'otro'];
const EXPENSE_CATEGORIES = ['nomina', 'materias_primas', 'servicios', 'arriendo', 'otro'];

function dateToString(date) {
  const dateCol = date.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const [y, m, d] = dateCol.split('-');
  return `${y}-${m}-${d}`;
}

function periodRange(query, tz = 'America/Bogota') {
  // Accept ?month=YYYY-MM (preferred) or ?period=day|week|month (legacy)
  if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
    const [yr, mo] = query.month.split('-').map(Number);
    const start = `${query.month}-01`;
    const lastDay = new Date(yr, mo, 0).getDate();
    const end = `${query.month}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }

  const period = query.period || 'month';
  // Always derive today from the business timezone to avoid UTC offset issues
  const todayCol = new Date().toLocaleDateString('en-CA', { timeZone: tz });

  if (!['day', 'week', 'month'].includes(period)) {
    return { start: todayCol, end: todayCol };
  }

  if (period === 'day') {
    // Use the date param as-is (frontend sends Colombia date), fallback to Colombia today
    const dayStr = (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) ? query.date : todayCol;
    return { start: dayStr, end: dayStr };
  }

  // For week/month calculations, build a local Date from Colombia's today string
  // to avoid getDay()/getDate() returning wrong values in UTC offset environments
  const [cy, cm, cd] = todayCol.split('-').map(Number);
  const now = new Date(cy, cm - 1, cd); // local noon avoids DST edge cases

  if (period === 'week') {
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(cy, cm - 1, cd + daysToMonday);
    const sunday = new Date(cy, cm - 1, cd + daysToMonday + 6);
    return {
      start: dateToString(monday),
      end: dateToString(sunday),
    };
  }

  return {
    start: `${todayCol.slice(0, 7)}-01`,
    end: dateToString(new Date(cy, cm, 0)),
  };
}

function fmtCOP(v) {
  return `$${new Intl.NumberFormat('es-CO').format(Math.round(v ?? 0))}`;
}

// Respeta el trial (que da acceso equivalente a Estándar) igual que
// checkFeatureAccess; cae a req.business.plan si no hay planInfo.
function isLitePlan(req) {
  const plan = req.planInfo?.plan || req.business?.plan;
  return plan === 'lite';
}

function blockLite(req, res) {
  if (isLitePlan(req)) {
    res.status(403).json({ success: false, error: 'Esta función requiere el plan Estándar o superior' });
    return true;
  }
  return false;
}

// ──────────────────────────────────────────
// GET /api/cash/summary?period=day|week|month
// ──────────────────────────────────────────
async function getSummary(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const tz = getTimezone(req.business?.country);
    const offset = getOffsetForTz(tz);
    const { start, end } = periodRange(req.query, tz);

    // Lite: acceso reducido — solo ingresos + meta mensual, sin egresos
    // ni desglose Resumen/Ingresos/Egresos.
    if (isLitePlan(req)) {
      const monthStart = `${start.slice(0, 7)}-01`;
      const [{ data: periodIncome }, { data: goalRow }] = await Promise.all([
        userClient.from('income').select('amount')
          .eq('business_id', req.businessId)
          .gte('date', start)
          .lte('date', end),
        userClient.from('monthly_goals').select('income_goal')
          .eq('business_id', req.businessId)
          .eq('month', monthStart)
          .maybeSingle(),
      ]);

      const ingresos = (periodIncome || []).reduce((s, r) => s + Number(r.amount), 0);

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      return res.json({
        success: true,
        data: {
          ingresos,
          meta_mensual: goalRow?.income_goal ?? null,
        },
      });
    }

    // Last 6 months for chart
    const chartFrom = new Date();
    chartFrom.setMonth(chartFrom.getMonth() - 5);
    chartFrom.setDate(1);
    const chartStart = chartFrom.toISOString().slice(0, 10);

    const startTS = `${start}T00:00:00${offset}`;
    const endTS = `${end}T23:59:59${offset}`;
    const chartStartTS = `${chartStart}T00:00:00Z`;

    const [
      { data: periodIncome },
      { data: periodExpenses },
      { data: chartIncome },
      { data: chartExpenses },
    ] = await Promise.all([
      userClient.from('income').select('amount')
        .eq('business_id', req.businessId)
        .gte('date', start)
        .lte('date', end),
      userClient.from('expenses').select('amount, category')
        .eq('business_id', req.businessId)
        .gte('date', start)
        .lte('date', end),
      userClient.from('income').select('amount, date')
        .eq('business_id', req.businessId)
        .gte('date', chartStart),
      userClient.from('expenses').select('amount, date')
        .eq('business_id', req.businessId)
        .gte('date', chartStart),
    ]);

    const incomeTotal       = (periodIncome  || []).reduce((s, r) => s + Number(r.amount), 0);
    const costoVentas       = (periodExpenses|| []).filter(r => r.category === 'costo_producto').reduce((s, r) => s + Number(r.amount), 0);
    const egresosOperativos = (periodExpenses|| []).filter(r => r.category !== 'costo_producto').reduce((s, r) => s + Number(r.amount), 0);
    const expenseTotal      = costoVentas + egresosOperativos;
    const ganancia_neta     = incomeTotal - expenseTotal;
    const margen_porcentaje = incomeTotal > 0 ? Math.round((ganancia_neta / incomeTotal) * 100) : 0;

    // Build 6-month chart
    const chartMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
      chartMap[key] = { month: key, income: 0, expenses: 0 };
    }
    for (const r of (chartIncome   || [])) { const k = r.date.slice(0, 7);         if (chartMap[k]) chartMap[k].income   += Number(r.amount); }
    for (const r of (chartExpenses || [])) { const k = r.date.slice(0, 7);         if (chartMap[k]) chartMap[k].expenses += Number(r.amount); }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    return res.json({
      success: true,
      data: {
        income_total:        incomeTotal,
        expense_total:       expenseTotal,
        costo_ventas:        costoVentas,
        egresos_operativos:  egresosOperativos,
        ganancia_neta:       ganancia_neta,
        margen_porcentaje:   margen_porcentaje,
        net:                 incomeTotal - expenseTotal,
        chart_data:          Object.values(chartMap),
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
    const tz = getTimezone(req.business?.country);
    const offset = getOffsetForTz(tz);
    let { start, end } = periodRange(req.query, tz);

    const startTS = `${start}T00:00:00${offset}`;
    const endTS = `${end}T23:59:59${offset}`;

    const { data: incomeData, error: incErr } = await userClient
      .from('income')
      .select('id, amount, category, description, custom_category, client_id, services_detail, source, date, created_at, clients(name)')
      .eq('business_id', req.businessId)
      .gte('date', start)
      .lte('date', end)
      .order('created_at', { ascending: false });

    if (incErr) throw incErr;

    return res.json({ success: true, data: incomeData || [] });
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
    if (blockLite(req, res)) return;
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
    const { data, error } = await userClient.from('income').delete()
      .eq('id', req.params.id).eq('business_id', req.businessId).select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Ingreso no encontrado.' });
    }
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
    if (blockLite(req, res)) return;
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
    if (blockLite(req, res)) return;
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
    if (blockLite(req, res)) return;
    const userClient = createUserClient(req.headers.authorization);
    const { data, error } = await userClient.from('expenses').delete()
      .eq('id', req.params.id).eq('business_id', req.businessId).select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Egreso no encontrado.' });
    }
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
    const tz = getTimezone(req.business?.country);
    const offset = getOffsetForTz(tz);
    const month  = req.query.month || new Date().toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const start  = `${month}-01`;
    const end    = new Date(yr, mo, 0).toISOString().slice(0, 10);
    const startTS = `${start}T00:00:00${offset}`;
    const endTS   = `${end}T23:59:59${offset}`;
    const MONTHS  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const monthLabel = `${MONTHS[mo-1]} ${yr}`;
    const today = new Date().toLocaleDateString('es-CO', { timeZone: tz });

    const [{ data: incomeData }, { data: allExpensesData }, { data: biz }] = await Promise.all([
      userClient.from('income').select('amount,category,description,date,clients(name)').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('expenses').select('amount,category,description,date').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('businesses').select('name').eq('id', req.businessId).single(),
    ]);

    const costExpenses = (allExpensesData || []).filter(r => r.category === 'costo_producto');
    const opExpenses   = (allExpensesData || []).filter(r => r.category !== 'costo_producto');

    const allIncome = (incomeData || []).map(r => ({ date: r.date, desc: r.description || r.category, cat: r.category || 'otro', amount: Number(r.amount) })).sort((a,b) => a.date.localeCompare(b.date));

    const CAT_LABELS = { nomina:'Nómina', materias_primas:'Materias primas', servicios:'Servicios', arriendo:'Arriendo', otro:'Otro', costo_producto:'Costo producto' };

    const totalIngresos     = allIncome.reduce((s,r) => s + r.amount, 0);
    const costoVentas       = costExpenses.reduce((s,r) => s + Number(r.amount), 0);
    const margenBruto       = totalIngresos - costoVentas;
    const egresosOperativos = opExpenses.reduce((s,r) => s + Number(r.amount), 0);
    const utilidadNeta      = margenBruto - egresosOperativos;
    const pctMargen         = totalIngresos > 0 ? (utilidadNeta / totalIngresos * 100) : 0;

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="libro-caja-${month}.pdf"`);
    doc.pipe(res);

    const PAGE_W = 595;
    const MARGIN = 40;
    const CW = PAGE_W - MARGIN * 2;

    const drawFooter = () => {
      doc.fontSize(7).fillColor('#94a3b8').font('Helvetica')
        .text('Documento generado por ZITA · No reemplaza documentos contables oficiales',
          MARGIN, doc.page.height - 22, { align: 'center', width: CW });
    };

    const checkPage = (h = 15) => {
      if (doc.y + h > doc.page.height - 45) {
        drawFooter();
        doc.addPage({ margin: 0 });
        doc.y = 20;
      }
    };

    const sectionTitle = (title) => {
      checkPage(30);
      const ty = doc.y + 6;
      doc.rect(MARGIN, ty, CW, 22).fill('#7c3aed');
      doc.fontSize(10).fillColor('#ffffff').font('Helvetica-Bold')
        .text(title, MARGIN + 10, ty + 6, { lineBreak: false });
      doc.y = ty + 28;
    };

    const tableHeader = (cols) => {
      const rowY = doc.y;
      doc.rect(MARGIN, rowY, CW, 15).fill('#e2e8f0');
      doc.fontSize(7.5).fillColor('#475569').font('Helvetica-Bold');
      cols.forEach(c => doc.text(c.label, MARGIN + c.x, rowY + 4, { width: c.w, align: c.align || 'left', lineBreak: false }));
      doc.y = rowY + 15;
    };

    const tableRow = (cols, i) => {
      checkPage(14);
      const rowY = doc.y;
      doc.rect(MARGIN, rowY, CW, 13).fill(i % 2 === 0 ? '#f8fafc' : '#ffffff');
      doc.fontSize(7.5).font('Helvetica');
      cols.forEach(c => {
        doc.fillColor(c.color || '#334155');
        doc.text(String(c.val ?? '—'), MARGIN + c.x, rowY + 3, { width: c.w, align: c.align || 'left', lineBreak: false });
      });
      doc.y = rowY + 13;
    };

    const totalRow = (label, amount, color) => {
      checkPage(16);
      const rowY = doc.y;
      doc.rect(MARGIN, rowY, CW, 16).fill('#f1f5f9');
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#334155')
        .text(label, MARGIN + 5, rowY + 4, { width: CW - 110, lineBreak: false });
      doc.fillColor(color || '#334155')
        .text(fmtCOP(amount), MARGIN, rowY + 4, { width: CW - 5, align: 'right' });
      doc.y = rowY + 16;
    };

    // ── HEADER ──────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 75).fill('#7c3aed');
    doc.fontSize(26).fillColor('#ffffff').font('Helvetica-Bold').text('ZITA', MARGIN, 14);
    doc.fontSize(10).fillColor('#e9d5ff').font('Helvetica').text('Libro de Caja', MARGIN, 44);
    doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold')
      .text(biz?.name || 'Mi negocio', 0, 14, { align: 'right', width: PAGE_W - MARGIN });
    doc.fontSize(9).fillColor('#e9d5ff').font('Helvetica')
      .text(`${monthLabel} · Generado: ${today}`, 0, 32, { align: 'right', width: PAGE_W - MARGIN });
    doc.fontSize(8).fillColor('#ddd6fe')
      .text(`Período: ${start} al ${end}`, 0, 50, { align: 'right', width: PAGE_W - MARGIN });
    doc.y = 92;

    // ── RESUMEN EJECUTIVO (6 KPIs, 2 filas × 3) ──────────────────────
    const kpis = [
      { label: 'Total Ingresos',     val: fmtCOP(totalIngresos),     color: '#059669', bg: '#f0fdf4' },
      { label: 'Costo de Ventas',    val: fmtCOP(costoVentas),       color: '#d97706', bg: '#fffbeb' },
      { label: 'Margen Bruto',       val: fmtCOP(margenBruto),       color: margenBruto >= 0 ? '#059669' : '#dc2626', bg: '#f0fdf4' },
      { label: 'Egresos Operativos', val: fmtCOP(egresosOperativos), color: '#dc2626', bg: '#fef2f2' },
      { label: 'Utilidad Neta',      val: fmtCOP(utilidadNeta),      color: utilidadNeta >= 0 ? '#059669' : '#dc2626', bg: utilidadNeta >= 0 ? '#f0fdf4' : '#fef2f2' },
      { label: '% Margen',           val: pctMargen.toFixed(1) + '%', color: pctMargen >= 0 ? '#7c3aed' : '#dc2626', bg: '#f5f3ff' },
    ];
    const boxW = Math.floor((CW - 10) / 3);
    const boxH = 52;
    const startY = doc.y;
    kpis.forEach((k, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const bx = MARGIN + col * (boxW + 5);
      const by = startY + row * (boxH + 5);
      doc.rect(bx, by, boxW, boxH).fill(k.bg);
      doc.rect(bx, by, 3, boxH).fill(k.color);
      doc.fontSize(7.5).fillColor('#64748b').font('Helvetica')
        .text(k.label, bx + 8, by + 8, { width: boxW - 12, lineBreak: false });
      doc.fontSize(12).fillColor(k.color).font('Helvetica-Bold')
        .text(k.val, bx + 8, by + 22, { width: boxW - 12, lineBreak: false });
    });
    doc.y = startY + 2 * (boxH + 5) + 12;

    // ── INGRESOS ─────────────────────────────────────────────────────
    sectionTitle('Ingresos Detallados');
    tableHeader([
      { label: 'Fecha',       x: 0,   w: 65  },
      { label: 'Descripción', x: 70,  w: 265 },
      { label: 'Categoría',   x: 340, w: 90  },
      { label: 'Monto',       x: 430, w: 85, align: 'right' },
    ]);
    allIncome.forEach((r, i) => tableRow([
      { val: r.date,  x: 0,   w: 65 },
      { val: r.desc,  x: 70,  w: 265 },
      { val: r.cat.charAt(0).toUpperCase() + r.cat.slice(1), x: 340, w: 90 },
      { val: fmtCOP(r.amount), x: 430, w: 85, align: 'right', color: '#059669' },
    ], i));
    totalRow('Total Ingresos', totalIngresos, '#059669');

    // ── COSTO DE VENTAS ───────────────────────────────────────────────
    if (costExpenses.length > 0) {
      doc.y += 8;
      sectionTitle('Costo de Ventas');
      tableHeader([
        { label: 'Fecha',       x: 0,   w: 65  },
        { label: 'Descripción', x: 70,  w: 360 },
        { label: 'Monto',       x: 430, w: 85, align: 'right' },
      ]);
      costExpenses.forEach((r, i) => tableRow([
        { val: r.date,              x: 0,   w: 65 },
        { val: r.description || '—', x: 70,  w: 360 },
        { val: fmtCOP(r.amount),    x: 430, w: 85, align: 'right', color: '#d97706' },
      ], i));
      totalRow('Total Costo de Ventas', costoVentas, '#d97706');

      checkPage(16);
      const mby = doc.y + 4;
      doc.rect(MARGIN, mby, CW, 14).fill('#ecfdf5');
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#059669')
        .text('Margen Bruto (Ingresos − Costo de Ventas):', MARGIN + 6, mby + 3, { width: CW - 110, lineBreak: false });
      doc.text(fmtCOP(margenBruto), MARGIN, mby + 3, { width: CW - 5, align: 'right' });
      doc.y = mby + 18;
    }

    // ── EGRESOS OPERATIVOS ────────────────────────────────────────────
    doc.y += 8;
    sectionTitle('Egresos Operativos');
    if (opExpenses.length === 0) {
      checkPage(20);
      doc.fontSize(8).fillColor('#94a3b8').font('Helvetica')
        .text('Sin egresos operativos en el período.', MARGIN + 6, doc.y + 4);
      doc.y += 18;
    } else {
      tableHeader([
        { label: 'Fecha',       x: 0,   w: 65  },
        { label: 'Descripción', x: 70,  w: 240 },
        { label: 'Categoría',   x: 315, w: 115 },
        { label: 'Monto',       x: 430, w: 85, align: 'right' },
      ]);
      opExpenses.forEach((r, i) => tableRow([
        { val: r.date,                              x: 0,   w: 65  },
        { val: r.description || '—',                x: 70,  w: 240 },
        { val: CAT_LABELS[r.category] || r.category, x: 315, w: 115 },
        { val: fmtCOP(r.amount),                    x: 430, w: 85, align: 'right', color: '#dc2626' },
      ], i));
    }
    totalRow('Total Egresos Operativos', egresosOperativos, '#dc2626');

    // ── RESULTADO FINAL ───────────────────────────────────────────────
    doc.y += 10;
    checkPage(46);
    const finalColor = utilidadNeta >= 0 ? '#059669' : '#dc2626';
    const fy = doc.y;
    doc.rect(MARGIN, fy, CW, 40).fill(utilidadNeta >= 0 ? '#f0fdf4' : '#fef2f2');
    doc.rect(MARGIN, fy, 4, 40).fill(finalColor);
    doc.fontSize(9).fillColor('#334155').font('Helvetica-Bold')
      .text('UTILIDAD NETA DEL PERÍODO', MARGIN + 12, fy + 7, { lineBreak: false });
    doc.fontSize(8).fillColor('#64748b').font('Helvetica')
      .text(`Margen Bruto ${fmtCOP(margenBruto)} − Egresos Operativos ${fmtCOP(egresosOperativos)}`,
        MARGIN + 12, fy + 20, { lineBreak: false, width: CW - 120 });
    doc.fontSize(14).fillColor(finalColor).font('Helvetica-Bold')
      .text(`${fmtCOP(utilidadNeta)}  (${pctMargen.toFixed(1)}%)`,
        MARGIN, fy + 10, { width: CW - 8, align: 'right' });
    doc.y = fy + 40;

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
    const tz = getTimezone(req.business?.country);
    const offset = getOffsetForTz(tz);
    const month  = req.query.month || new Date().toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const start  = `${month}-01`;
    const end    = new Date(yr, mo, 0).toISOString().slice(0, 10);
    const startTS = `${start}T00:00:00${offset}`;
    const endTS   = `${end}T23:59:59${offset}`;
    const MONTHS  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const monthLabel = `${MONTHS[mo - 1]} ${yr}`;
    const today  = new Date().toLocaleDateString('es-CO', { timeZone: tz });

    const [{ data: incomeData }, { data: allExpensesData }, { data: biz }] = await Promise.all([
      userClient.from('income').select('amount,category,description,date,clients(name)').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('expenses').select('amount,category,description,date').eq('business_id', req.businessId).gte('date', start).lte('date', end).order('date'),
      userClient.from('businesses').select('name').eq('id', req.businessId).single(),
    ]);

    const CAT = { nomina:'Nómina', materias_primas:'Materias primas', servicios:'Servicios', arriendo:'Arriendo', otro:'Otro', costo_producto:'Costo producto' };

    const allIncome = (incomeData || []).map(r => ({ date: r.date, desc: r.description || r.category, client: r.clients?.name || '—', cat: r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Otro', source: 'Manual', amount: Number(r.amount) })).sort((a, b) => a.date.localeCompare(b.date));

    const costExpenses = (allExpensesData || []).filter(r => r.category === 'costo_producto')
      .map(r => ({ date: r.date, desc: r.description || '—', amount: Number(r.amount) }));
    const opExpenses = (allExpensesData || []).filter(r => r.category !== 'costo_producto')
      .map(r => ({ date: r.date, cat: CAT[r.category] || r.category, desc: r.description || '—', amount: Number(r.amount) }));

    const totalIngresos     = allIncome.reduce((s, r) => s + r.amount, 0);
    const costoVentas       = costExpenses.reduce((s, r) => s + r.amount, 0);
    const margenBruto       = totalIngresos - costoVentas;
    const egresosOperativos = opExpenses.reduce((s, r) => s + r.amount, 0);
    const utilidadNeta      = margenBruto - egresosOperativos;
    const pctMargen         = totalIngresos > 0 ? (utilidadNeta / totalIngresos * 100) : 0;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ZITA'; wb.created = new Date();

    const VIOLET = 'FF7C3AED'; const GREEN = 'FF059669'; const RED = 'FFDC2626';
    const ORANGE = 'FFD97706'; const WHITE = 'FFFFFFFF'; const LGRAY = 'FFF8FAFC';
    const DGRAY  = 'FF475569';

    const hdrStyle = (argb = VIOLET) => ({
      font: { bold: true, color: { argb: WHITE }, size: 10 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb } },
      alignment: { vertical: 'middle', horizontal: 'center', wrapText: false },
      border: { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } },
    });

    const applyHdr = (row, argb = VIOLET) => {
      row.eachCell(cell => Object.assign(cell, hdrStyle(argb)));
      row.height = 22;
    };

    const stripe = (row, i) => {
      if (i % 2 === 0) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LGRAY } }; });
    };

    const moneyCell = (row, col, argb) => {
      const c = row.getCell(col);
      c.numFmt = '$#,##0';
      c.alignment = { horizontal: 'right' };
      if (argb) c.font = { ...(c.font || {}), color: { argb } };
    };

    // ── HOJA 1: RESUMEN EJECUTIVO ─────────────────────────────────────
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 32 }, { width: 22 }];

    const t1 = ws1.addRow(['ZITA — Libro de Caja']);
    t1.getCell(1).font = { bold: true, size: 18, color: { argb: VIOLET } };
    t1.height = 32;
    ws1.addRow([biz?.name || 'Mi negocio']).getCell(1).font = { bold: true, size: 12, color: { argb: DGRAY } };
    ws1.addRow([`${monthLabel}   ·   Generado: ${today}`]).getCell(1).font = { size: 9, color: { argb: DGRAY }, italic: true };
    ws1.addRow([`Período: ${start} al ${end}`]).getCell(1).font = { size: 9, color: { argb: DGRAY }, italic: true };
    ws1.addRow([]);

    const sh = ws1.addRow(['Concepto', 'Monto']);
    applyHdr(sh);

    const kpiRows = [
      ['Total Ingresos',     totalIngresos,     GREEN,  true],
      ['Costo de Ventas',    costoVentas,        ORANGE, false],
      ['Margen Bruto',       margenBruto,        margenBruto >= 0 ? GREEN : RED, true],
      ['Egresos Operativos', egresosOperativos,  RED,    false],
      ['Utilidad Neta',      utilidadNeta,       utilidadNeta >= 0 ? GREEN : RED, true],
      ['% Margen sobre Ingresos', pctMargen.toFixed(2) + '%', VIOLET, true],
    ];
    kpiRows.forEach(([label, val, color, bold], i) => {
      const r = ws1.addRow([label, typeof val === 'number' ? val : val]);
      stripe(r, i);
      r.getCell(1).font = { bold, size: 10 };
      r.getCell(2).font = { bold, color: { argb: color }, size: 11 };
      if (typeof val === 'number') {
        r.getCell(2).numFmt = '$#,##0';
        r.getCell(2).alignment = { horizontal: 'right' };
      }
    });

    ws1.addRow([]);
    const note = ws1.addRow(['Documento generado por ZITA. No reemplaza documentos contables oficiales.']);
    note.getCell(1).font = { size: 8, color: { argb: DGRAY }, italic: true };

    // ── HOJA 2: INGRESOS ──────────────────────────────────────────────
    const ws2 = wb.addWorksheet('Ingresos');
    ws2.columns = [{ width: 13 }, { width: 36 }, { width: 22 }, { width: 14 }, { width: 10 }, { width: 16 }];
    const ih = ws2.addRow(['Fecha', 'Descripción', 'Cliente', 'Categoría', 'Fuente', 'Monto']);
    applyHdr(ih, GREEN);

    const incFirstRow = 2;
    allIncome.forEach((r, i) => {
      const row = ws2.addRow([r.date, r.desc, r.client, r.cat, r.source, r.amount]);
      stripe(row, i);
      moneyCell(row, 6, GREEN);
    });
    const incTotalRow = allIncome.length + 2;
    const it = ws2.addRow(['', '', '', '', 'TOTAL', { formula: `SUM(F${incFirstRow}:F${incTotalRow - 1})` }]);
    it.getCell(5).font = { bold: true, size: 10 };
    moneyCell(it, 6, GREEN);
    it.getCell(6).font = { bold: true, color: { argb: GREEN }, size: 11 };

    // ── HOJA 3: COSTO DE VENTAS ───────────────────────────────────────
    const ws3 = wb.addWorksheet('Costo de Ventas');
    ws3.columns = [{ width: 13 }, { width: 50 }, { width: 16 }];
    const ch3 = ws3.addRow(['Fecha', 'Descripción', 'Monto']);
    applyHdr(ch3, ORANGE);

    const costFirstRow = 2;
    costExpenses.forEach((r, i) => {
      const row = ws3.addRow([r.date, r.desc, r.amount]);
      stripe(row, i);
      moneyCell(row, 3, ORANGE);
    });
    if (costExpenses.length === 0) {
      ws3.addRow(['Sin datos', 'No se registraron costos de venta en este período', 0]);
    }
    const costTotalRow = costExpenses.length + 2;
    const ct = ws3.addRow(['', 'TOTAL', { formula: `SUM(C${costFirstRow}:C${costTotalRow - 1})` }]);
    ct.getCell(2).font = { bold: true, size: 10 };
    moneyCell(ct, 3, ORANGE);
    ct.getCell(3).font = { bold: true, color: { argb: ORANGE }, size: 11 };

    // ── HOJA 4: EGRESOS OPERATIVOS ────────────────────────────────────
    const ws4 = wb.addWorksheet('Egresos Operativos');
    ws4.columns = [{ width: 13 }, { width: 36 }, { width: 20 }, { width: 16 }];
    const eh = ws4.addRow(['Fecha', 'Descripción', 'Categoría', 'Monto']);
    applyHdr(eh, RED);

    const opFirstRow = 2;
    opExpenses.forEach((r, i) => {
      const row = ws4.addRow([r.date, r.desc, r.cat, r.amount]);
      stripe(row, i);
      moneyCell(row, 4, RED);
    });
    if (opExpenses.length === 0) {
      ws4.addRow(['Sin datos', 'No se registraron egresos operativos en este período', '', 0]);
    }
    const opTotalRow = opExpenses.length + 2;
    const et = ws4.addRow(['', '', 'TOTAL', { formula: `SUM(D${opFirstRow}:D${opTotalRow - 1})` }]);
    et.getCell(3).font = { bold: true, size: 10 };
    moneyCell(et, 4, RED);
    et.getCell(4).font = { bold: true, color: { argb: RED }, size: 11 };

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
    // Reporte de productos vendidos: parte del módulo 'productos', que
    // permanece exclusivo de Estándar/Pro (no está en el acceso reducido
    // de Lite a Caja, que es solo ingresos).
    if (blockLite(req, res)) return;
    const businessId = req.businessId;

    logger.info('Req business completo:', { business: JSON.stringify(req.business) });
    logger.info('Business ID resuelto:', { businessId });

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

    logger.info('Período consultado', { mes, inicio, fin, resultsCount: data?.length });

    if (error) throw error;

    const agrupado = {};
    // Ventas por pedido (tienda web y pedidos manuales, no cancelados): sus líneas, en hora de Colombia
    const { data: orders, error: oErr } = await supabaseAdmin
      .from('orders')
      .select('id, source, created_at')
      .eq('business_id', businessId)
      .or('status.is.null,status.neq.cancelado')
      .gte('created_at', inicio + 'T00:00:00-05:00')
      .lte('created_at', fin + 'T23:59:59-05:00');
    if (oErr) throw oErr;
    const orderById = Object.fromEntries((orders || []).map((o) => [o.id, o]));
    let orderItems = [];
    if (orders?.length) {
      const { data: items, error: iErr } = await supabaseAdmin
        .from('order_items')
        .select('order_id, description, quantity, total_price, products(name)')
        .eq('business_id', businessId)
        .in('order_id', orders.map((o) => o.id));
      if (iErr) throw iErr;
      orderItems = items || [];
    }
    for (const it of orderItems) {
      const o = orderById[it.order_id];
      const nombre = it.products?.name || it.description || 'Sin nombre';
      if (!agrupado[nombre]) agrupado[nombre] = { nombre, unidades: 0, total: 0, ventas: [] };
      agrupado[nombre].unidades += Number(it.quantity) || 0;
      agrupado[nombre].total += Number(it.total_price) || 0;
      agrupado[nombre].ventas.push({
        fecha: new Date(o.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
        cantidad: Number(it.quantity) || 0,
        total: Number(it.total_price) || 0,
        canal: o.source === 'web' ? 'tienda web' : 'pedido',
        detalle: it.description || null,
      });
    }

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
    logger.error('Error en products-sold:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getSummary, getIncome, getExpenses,
  createIncome, updateIncome, deleteIncome,
  createExpense, updateExpense, deleteExpense,
  exportPdf, getExcel, getProductsSold,
  periodRange, dateToString,
};
