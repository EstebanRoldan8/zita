// Quita de la tienda pública los datos personales de la titular legal (nombre, cédula/NIT, matrícula) y deja
// solo los de la marca: "FLOW" como vendedor, correo, WhatsApp oficial, ciudad/país y el canal de PQR.
// Se aplica por SUSTITUCIÓN sobre los archivos generados (no toca los Word de _pruebas/legal/).
// Reproducible e idempotente: si un texto ya está sustituido, se salta; si no aparece ni el original ni el
// nuevo, falla (el generado cambió y hay que revisar). Al final busca que no quede ningún dato.
// REVISAR ABOGADO: las frases reescritas no vienen de los Word aprobados.
// Uso (desde frontend/):  node scripts/legal-sin-datos-titular.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const UPDATED = 'Actualizado el 29 de octubre de 2026';

// Lo que no puede quedar en ningún archivo público (minúsculas, sin tildes)
const FORBIDDEN = [/lizeth/i, /natalia/i, /l[oó]pez\s+p[eé]rez/i, /1\.?144\.?052\.?790/, /1220888/, /matr[ií]cula mercantil/i, /\bc\.c\.\s*y\s*nit\b/i, /c[eé]dula y nit/i, /\bnit\b/i];

const SIGN_OWNER = `"lines": [
              "LIZETH NATALIA LOPEZ PEREZ",
              "Titular de la marca FLOW",
              "C.C. y NIT 1.144.052.790-7"
            ]`;
const SIGN_BRAND = `"lines": [
              "FLOW",
              "flowactivewear.co@gmail.com"
            ]`;

const EDITS = {
  'src/store/content/flowLegal.js': [
    // Términos: tabla "Información del vendedor"
    [`              [
                "Titular",
                "LIZETH NATALIA LOPEZ PEREZ, persona natural comerciante"
              ],
              [
                "Cédula y NIT",
                "1.144.052.790-7"
              ],
              [
                "Matrícula mercantil",
                "1220888 – Cámara de Comercio de Cali"
              ],
              [
                "Domicilio",`, `              [
                "Vendedor",
                "FLOW"
              ],
              [
                "Domicilio",`],
    // Términos: identificación (la frase se reescribe para que no quede "identificada con NIT ...")
    ['"text": "La tienda FLOW ACTIVE es operada por **LIZETH NATALIA LOPEZ PEREZ**, persona natural comerciante, identificada con cédula de ciudadanía y NIT 1.144.052.790-7, inscrita en el registro mercantil de la Cámara de Comercio de Cali con matrícula 1220888, con domicilio en Santiago de Cali y dirección de notificaciones en {{notificaciones}}. Puedes contactarnos en flowactivewear.co@gmail.com, por WhatsApp al {{whatsapp}} o por Instagram en @flow.col. En estos términos, \\"FLOW\\" o \\"nosotros\\" se refiere a la titular indicada."',
      '"text": "La tienda en línea FLOW ACTIVE es operada por **FLOW**, con domicilio en Santiago de Cali, Colombia. Dirección de notificaciones: {{notificaciones}}. Puedes contactarnos en flowactivewear.co@gmail.com, por WhatsApp al {{whatsapp}} o por Instagram en @flow.col. En estos términos, \\"FLOW\\" o \\"nosotros\\" se refiere a quien opera la tienda."'],
    // Términos y Promociones: firmas (dos apariciones idénticas)
    [SIGN_OWNER, SIGN_BRAND, { all: true }],
    // Privacidad: tabla del responsable
    [`              [
                "Responsable",
                "LIZETH NATALIA LOPEZ PEREZ, persona natural comerciante, propietaria de la marca FLOW"
              ],
              [
                "Cédula y NIT",
                "1.144.052.790-7"
              ],`, `              [
                "Responsable",
                "FLOW, tienda en línea FLOW ACTIVE"
              ],`],
    // Privacidad: firma
    [`"lines": [
              "LIZETH NATALIA LOPEZ PEREZ",
              "Responsable del tratamiento",
              "C.C. y NIT 1.144.052.790-7"
            ]`, `"lines": [
              "FLOW",
              "Responsable del tratamiento"
            ]`],
    // Envíos y pagos: medios de pago (sin el nombre; los datos de la cuenta llegan por WhatsApp)
    [`"Transferencia a cuenta de ahorros Bancolombia a nombre de **LIZETH NATALIA LOPEZ PEREZ**.",
              "Llave a nombre de **LIZETH NATALIA LOPEZ PEREZ**."`,
    `"Transferencia a cuenta de ahorros Bancolombia. Los datos de la cuenta te los enviamos por WhatsApp desde nuestra línea oficial.",
              "Llave. Te la enviamos por WhatsApp desde nuestra línea oficial."`],
    // Preguntas frecuentes: cómo pagar
    ['"text": "Por transferencia a Bancolombia (ahorros) o llave, siempre a nombre de **LIZETH NATALIA LOPEZ PEREZ**. Te enviamos los datos por WhatsApp y tienes 24 horas para pagar."',
      '"text": "Por transferencia a Bancolombia (ahorros) o llave. Te enviamos los datos por WhatsApp desde nuestra línea oficial y tienes 24 horas para pagar."'],
    // Términos: aviso antifraude de pagos (sin el nombre; el canal oficial es la referencia)
    ['**La cuenta y la llave siempre están a nombre de LIZETH NATALIA LOPEZ PEREZ.** Nunca te pediremos pagar a una cuenta a nombre de otra persona ni te pediremos claves o códigos de tu banco.',
      '**Los datos de la cuenta y la llave solo te los enviamos desde nuestra línea oficial de WhatsApp.** Nunca te pediremos pagar a una cuenta que no te hayamos enviado por ese canal ni te pediremos claves o códigos de tu banco.'],
    // Fechas visibles: se nota que el texto cambió
    ['"effective": "Fecha de vigencia: 23 de octubre de 2026",', `"effective": "Fecha de vigencia: 23 de octubre de 2026 · ${UPDATED}",`],
    ['"effective": "Fecha de entrada en vigencia: 23 de octubre de 2026.",', `"effective": "Fecha de entrada en vigencia: 23 de octubre de 2026. ${UPDATED}.",`],
    ['// (salen de flowContent.brand / flowContent.seller) y {{link:/ruta|texto}} (enlace interno sobre el mismo texto).',
      '// (salen de flowContent.brand / flowContent.seller) y {{link:/ruta|texto}} (enlace interno sobre el mismo texto).\n// Sin datos personales de la titular: scripts/legal-sin-datos-titular.mjs (29 de octubre de 2026, REVISAR ABOGADO).'],
  ],
  'src/store/lib/copy.js': [
    ["// Aviso de privacidad del formulario de compra: Anexo 1.1 de las políticas aprobadas (texto literal, no reescribir)",
      '// Aviso de privacidad del formulario de compra: Anexo 1.1 de las políticas aprobadas, sin los datos personales de la\n// titular (scripts/legal-sin-datos-titular.mjs; REVISAR ABOGADO)'],
    ["'LIZETH NATALIA LOPEZ PEREZ, identificada con cédula y NIT 1.144.052.790-7, con domicilio en Cali, propietaria de la marca FLOW, es responsable",
      "'FLOW, con domicilio en Cali, es responsable"],
  ],
  'src/store/content/flowContent.js': [
    [`  // Titular de la marca (Información del vendedor y textos legales). notificationAddress reemplaza
  // [DIRECCIÓN DE NOTIFICACIONES] del Word: PENDIENTE de confirmar con el abogado.
  seller: {
    legalName: 'LIZETH NATALIA LOPEZ PEREZ',
    nit: '1.144.052.790-7',
    matricula: '1220888',
    notificationAddress:`, `  // Vendedor en los textos legales: solo datos de la marca (sin datos personales de la titular).
  // notificationAddress reemplaza [DIRECCIÓN DE NOTIFICACIONES] del Word: PENDIENTE de confirmar con el abogado.
  seller: {
    notificationAddress:`],
  ],
};

let changed = 0;
for (const [rel, edits] of Object.entries(EDITS)) {
  const file = path.join(root, rel);
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  for (const [from, to, opts = {}] of edits) {
    if (s.includes(to)) continue; // ya sustituido
    if (s.includes(from)) {
      if (CHECK_ONLY) { console.error(`PENDIENTE en ${rel}: ${from.slice(0, 70)}…`); process.exitCode = 1; continue; }
      s = opts.all ? s.split(from).join(to) : s.replace(from, to);
      changed += 1;
    } else {
      console.error(`NO ENCONTRADO en ${rel} (ni original ni sustituido): ${from.slice(0, 70)}…`);
      process.exitCode = 1;
    }
  }
  if (!CHECK_ONLY) fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
}

// Verificación: ningún dato de la titular en el código público de la tienda
const scan = ['src/store', 'api'];
const hits = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|jsx|json|html)$/.test(e.name) && !p.endsWith('legal-sin-datos-titular.mjs')) {
      fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
};
for (const d of scan) walk(path.join(root, d));
console.log(`${CHECK_ONLY ? 'Revisión' : `Sustituciones aplicadas: ${changed}`}. Datos de la titular encontrados: ${hits.length}`);
for (const h of hits) console.log('  ' + h);
if (hits.length) process.exitCode = 1;
