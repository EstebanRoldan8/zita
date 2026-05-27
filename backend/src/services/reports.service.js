const PDFDocument = require('pdfkit');
const { supabaseAdmin } = require('../config/supabase');

const VIOLET   = '#7c3aed';
const SLATE_50  = '#f8fafc';
const SLATE_200 = '#e2e8f0';
const SLATE_500 = '#64748b';
const SLATE_900 = '#0f172a';
const WHITE     = '#ffffff';

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function fmtCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function sum(arr, field) {
  return (arr || []).reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

function monthRange(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const start   = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end     = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end, year, month };
}

function prevMonthRange(monthStr) {
  const { year, month } = monthRange(monthStr);
  const pm = month === 1 ? 12 : month - 1;
  const py = month === 1 ? year - 1 : year;
  return monthRange(`${py}-${String(pm).padStart(2, '0')}`);
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function sectionHeader(doc, title) {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(1);
  doc.fillColor(VIOLET).font('Helvetica-Bold').fontSize(10).text(title.toUpperCase());
  doc.moveDown(0.2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(1).strokeColor(VIOLET).stroke();
  doc.moveDown(0.6);
}

function drawTable(doc, headers, rows, colWidths) {
  const x      = 50;
  const ROW_H  = 20;
  const HDR_H  = 22;
  const PX     = 5;
  const totalW = colWidths.reduce((a, b) => a + b, 0);

  if (doc.y + HDR_H + ROW_H * Math.min(rows.length, 3) > 800) doc.addPage();

  let y = doc.y;

  // Header band
  doc.rect(x, y, totalW, HDR_H).fill(VIOLET);
  let cx = x;
  headers.forEach((h, i) => {
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8)
      .text(h, cx + PX, y + 7, { width: colWidths[i] - PX * 2, lineBreak: false });
    cx += colWidths[i];
  });
  y += HDR_H;

  rows.forEach((row, ri) => {
    if (y + ROW_H > 810) { doc.addPage(); y = 50; }

    doc.rect(x, y, totalW, ROW_H).fill(ri % 2 === 0 ? SLATE_50 : WHITE);

    cx = x;
    row.forEach((cell, ci) => {
      doc.fillColor(SLATE_900).font('Helvetica').fontSize(8)
        .text(String(cell ?? '—'), cx + PX, y + 6, { width: colWidths[ci] - PX * 2, lineBreak: false });
      cx += colWidths[ci];
    });
    y += ROW_H;
  });

  doc.moveTo(x, y).lineTo(x + totalW, y).lineWidth(0.5).strokeColor(SLATE_200).stroke();
  doc.y = y + 10;
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function generateMonthlyReport(businessId, monthStr) {
  const { start, end, year, month } = monthRange(monthStr);
  const { start: ps, end: pe }      = prevMonthRange(monthStr);

  const sISO  = `${start}T00:00:00`;
  const eISO  = `${end}T23:59:59`;
  const psISO = `${ps}T00:00:00`;
  const peISO = `${pe}T23:59:59`;

  const [
    { data: biz           },
    { data: appts         },
    { data: manualIncome  },
    { data: prevAppts     },
    { data: prevManual    },
    { data: expenses      },
    { data: prevExpenses  },
    { data: employees     },
  ] = await Promise.all([
    supabaseAdmin.from('businesses').select('name, business_type').eq('id', businessId).single(),

    supabaseAdmin.from('appointments')
      .select('id, status, price, service_id, client_id, employee_id, services(name), clients(name)')
      .eq('business_id', businessId).gte('scheduled_at', sISO).lte('scheduled_at', eISO),

    supabaseAdmin.from('income').select('amount')
      .eq('business_id', businessId).gte('date', start).lte('date', end),

    supabaseAdmin.from('appointments').select('price')
      .eq('business_id', businessId).eq('status', 'completed')
      .gte('scheduled_at', psISO).lte('scheduled_at', peISO),

    supabaseAdmin.from('income').select('amount')
      .eq('business_id', businessId).gte('date', ps).lte('date', pe),

    supabaseAdmin.from('expenses').select('amount, category')
      .eq('business_id', businessId).gte('date', start).lte('date', end),

    supabaseAdmin.from('expenses').select('amount')
      .eq('business_id', businessId).gte('date', ps).lte('date', pe),

    supabaseAdmin.from('employees').select('id, name')
      .eq('business_id', businessId).eq('is_active', true),
  ]);

  const all       = appts || [];
  const completed = all.filter((a) => a.status === 'completed');

  // ── Financials ──────────────────────────────────────────────
  const totalIncome    = sum(completed, 'price') + sum(manualIncome, 'amount');
  const totalExpenses  = sum(expenses, 'amount');
  const netProfit      = totalIncome - totalExpenses;
  const prevIncome     = sum(prevAppts, 'price') + sum(prevManual, 'amount');
  const prevExpenses_  = sum(prevExpenses, 'amount');
  const prevNet        = prevIncome - prevExpenses_;
  const incomeChangePct = prevIncome > 0 ? ((totalIncome - prevIncome) / prevIncome) * 100 : null;

  // ── Top services ────────────────────────────────────────────
  const svcMap = {};
  completed.forEach((a) => {
    const name = a.services?.name || 'Sin servicio';
    if (!svcMap[name]) svcMap[name] = { name, count: 0, total: 0 };
    svcMap[name].count++;
    svcMap[name].total += Number(a.price) || 0;
  });
  const topServices = Object.values(svcMap).sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Top clients ─────────────────────────────────────────────
  const cliMap = {};
  completed.filter((a) => a.client_id).forEach((a) => {
    if (!cliMap[a.client_id]) cliMap[a.client_id] = { name: a.clients?.name || '—', count: 0, total: 0 };
    cliMap[a.client_id].count++;
    cliMap[a.client_id].total += Number(a.price) || 0;
  });
  const topClients = Object.values(cliMap).sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Employee performance ─────────────────────────────────────
  const empMap = Object.fromEntries((employees || []).map((e) => [e.id, { name: e.name, count: 0, income: 0 }]));
  completed.filter((a) => a.employee_id && empMap[a.employee_id]).forEach((a) => {
    empMap[a.employee_id].count++;
    empMap[a.employee_id].income += Number(a.price) || 0;
  });
  const empPerf = Object.values(empMap).sort((a, b) => b.income - a.income);

  // ── Appointment stats ────────────────────────────────────────
  const nCompleted = all.filter((a) => a.status === 'completed').length;
  const nCancelled = all.filter((a) => a.status === 'cancelled').length;
  const nPending   = all.filter((a) => a.status === 'pending').length;
  const nConfirmed = all.filter((a) => a.status === 'confirmed').length;
  const nTotal     = all.length;

  const pct = (n) => nTotal > 0 ? `${Math.round((n / nTotal) * 100)}%` : '0%';

  // ── Build PDF ────────────────────────────────────────────────
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  const bizName    = biz?.name || 'Mi negocio';
  const bizType    = biz?.business_type || '';
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  // Header band
  doc.rect(50, 50, 495, 65).fill(VIOLET);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20).text('ZITA', 65, 63);
  doc.fillColor('#c4b5fd').font('Helvetica').fontSize(9).text('Reporte Mensual', 65, 88);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13).text(bizName, 300, 63, { align: 'right', width: 230 });
  doc.fillColor('#c4b5fd').font('Helvetica').fontSize(9).text(`${bizType ? bizType + ' · ' : ''}${monthLabel}`, 300, 88, { align: 'right', width: 230 });

  doc.y = 140;

  // ── Resumen financiero ───────────────────────────────────────
  sectionHeader(doc, 'Resumen financiero');

  const comparativa = (curr, prev) => {
    if (!prev) return '—';
    const d = ((curr - prev) / prev) * 100;
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}% vs mes anterior`;
  };

  drawTable(doc,
    ['Concepto', 'Este mes', 'Comparativa'],
    [
      ['Ingresos totales', fmtCOP(totalIncome),   incomeChangePct !== null ? comparativa(totalIncome, prevIncome) : '—'],
      ['Egresos totales',  fmtCOP(totalExpenses),  comparativa(totalExpenses, prevExpenses_)],
      ['Ganancia neta',    fmtCOP(netProfit),       `Anterior: ${fmtCOP(prevNet)}`],
    ],
    [205, 145, 145]
  );

  // ── Estadísticas de citas ────────────────────────────────────
  sectionHeader(doc, 'Estadísticas de citas');

  drawTable(doc,
    ['Estado', 'Cantidad', '% del total'],
    [
      ['Completadas', nCompleted, pct(nCompleted)],
      ['Confirmadas', nConfirmed, pct(nConfirmed)],
      ['Canceladas',  nCancelled, pct(nCancelled)],
      ['Pendientes',  nPending,   pct(nPending)],
      ['TOTAL',       nTotal,     '100%'],
    ],
    [205, 145, 145]
  );

  // ── Top servicios ────────────────────────────────────────────
  sectionHeader(doc, 'Top 5 servicios más vendidos');

  if (topServices.length === 0) {
    doc.fillColor(SLATE_500).font('Helvetica').fontSize(9).text('Sin citas completadas en este período.'); doc.moveDown(1);
  } else {
    drawTable(doc,
      ['Servicio', 'Citas', 'Total ingresos'],
      topServices.map((s) => [s.name, s.count, fmtCOP(s.total)]),
      [255, 90, 150]
    );
  }

  // ── Top clientes ─────────────────────────────────────────────
  sectionHeader(doc, 'Top 5 clientes');

  if (topClients.length === 0) {
    doc.fillColor(SLATE_500).font('Helvetica').fontSize(9).text('Sin datos de clientes para este período.'); doc.moveDown(1);
  } else {
    drawTable(doc,
      ['Cliente', 'Visitas', 'Total gastado'],
      topClients.map((c) => [c.name, c.count, fmtCOP(c.total)]),
      [255, 90, 150]
    );
  }

  // ── Rendimiento por empleado ─────────────────────────────────
  sectionHeader(doc, 'Rendimiento por empleado');

  if (empPerf.length === 0) {
    doc.fillColor(SLATE_500).font('Helvetica').fontSize(9).text('Sin empleados activos.'); doc.moveDown(1);
  } else {
    drawTable(doc,
      ['Empleado', 'Citas', 'Ingresos generados', 'Promedio / cita'],
      empPerf.map((e) => [e.name, e.count, fmtCOP(e.income), e.count > 0 ? fmtCOP(e.income / e.count) : '—']),
      [175, 70, 140, 110]
    );
  }

  // Footer
  doc.moveDown(2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).strokeColor(SLATE_200).stroke();
  doc.moveDown(0.4);
  doc.fillColor(SLATE_500).font('Helvetica').fontSize(8)
    .text(`Generado el ${new Date().toLocaleDateString('es-CO')} · ZITA — Sistema de gestión de citas`, { align: 'center' });

  return new Promise((resolve, reject) => {
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { generateMonthlyReport };
