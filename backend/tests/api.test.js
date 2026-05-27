const fetch = require('node-fetch');

// Configurar variable de ambiente para saltarse rate limiting
process.env.SKIP_RATE_LIMIT = 'true';
process.env.NODE_ENV = 'development';

const BASE_URL = 'http://localhost:3000/api';
const TEST_EMAIL = 'barberia@test.com';
const TEST_PASSWORD = 'test1234';

let authToken = null;
let testIds = {
  service: null,
  client: null,
  appointment: null,
  employee: null,
  product: null,
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(status, endpoint, code, error = '') {
  if (status === 'PASS') {
    console.log(`${colors.green}✅ PASÓ${colors.reset} - ${endpoint} - ${code}`);
  } else {
    console.log(`${colors.red}❌ FALLÓ${colors.reset} - ${endpoint} - ${code} - ${error}`);
  }
}

async function request(method, endpoint, body = null, token = authToken) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  };

  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, data: { error: error.message } };
  }
}

async function runTests() {
  console.log(`\n${colors.yellow}🧪 INICIANDO TESTS DEL BACKEND ZITA${colors.reset}\n`);

  // ============= AUTH =============
  console.log(`${colors.yellow}━━━ AUTH ━━━${colors.reset}`);

  let res = await request('POST', '/auth/login', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  }, null);

  if (res.status === 200 && res.data.data?.session?.access_token) {
    authToken = res.data.data.session.access_token;
    log('PASS', 'POST /auth/login', res.status);
  } else {
    log('FAIL', 'POST /auth/login', res.status, res.data.error || 'No token returned');
  }

  res = await request('POST', '/auth/login', {
    email: TEST_EMAIL,
    password: 'wrongpassword',
  }, null);

  if (res.status !== 200) {
    log('PASS', 'POST /auth/login (credenciales incorrectas)', res.status);
  } else {
    log('FAIL', 'POST /auth/login (credenciales incorrectas)', res.status, 'Should have failed');
  }

  await sleep(300);

  // ============= SERVICIOS =============
  console.log(`\n${colors.yellow}━━━ SERVICIOS ━━━${colors.reset}`);

  res = await request('GET', '/services');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /services', res.status, res.data.error);

  res = await request('POST', '/services', {
    name: 'Corte Prueba',
    duration_minutes: 30,
    price: 25000,
  });

  if (res.status === 201) {
    testIds.service = res.data.data?.id;
    log('PASS', 'POST /services', res.status);
  } else {
    log('FAIL', 'POST /services', res.status, res.data.error);
  }

  if (testIds.service) {
    res = await request('PATCH', `/services/${testIds.service}`, {
      name: 'Corte Prueba Actualizado',
      price: 30000,
    });
    log(res.status === 200 ? 'PASS' : 'FAIL', 'PATCH /services/:id', res.status, res.data.error);
  }

  await sleep(300);

  // ============= CLIENTES =============
  console.log(`\n${colors.yellow}━━━ CLIENTES ━━━${colors.reset}`);

  res = await request('GET', '/clients');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /clients', res.status, res.data.error);

  const timestamp = Date.now();
  res = await request('POST', '/clients', {
    name: 'Cliente Prueba',
    phone: `+573001234${timestamp % 1000}`,
    email: `cliente${timestamp}@test.com`,
  });

  if (res.status === 201) {
    testIds.client = res.data.data?.id;
    log('PASS', 'POST /clients', res.status);
  } else {
    log('FAIL', 'POST /clients', res.status, res.data.error);
  }

  if (testIds.client) {
    res = await request('GET', `/clients/${testIds.client}`);
    log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /clients/:id', res.status, res.data.error);

    res = await request('PUT', `/clients/${testIds.client}`, {
      name: 'Cliente Prueba Actualizado',
    });
    log(res.status === 200 ? 'PASS' : 'FAIL', 'PUT /clients/:id', res.status, res.data.error);
  }

  await sleep(300);

  // ============= EMPLEADOS =============
  console.log(`\n${colors.yellow}━━━ EMPLEADOS ━━━${colors.reset}`);

  res = await request('GET', '/employees');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /employees', res.status, res.data.error);

  res = await request('POST', '/employees', {
    name: 'Empleado Prueba',
    email: 'empleado@test.com',
    role: 'stylist',
  });

  if (res.status === 201) {
    testIds.employee = res.data.data?.id;
    log('PASS', 'POST /employees', res.status);
  } else {
    log('FAIL', 'POST /employees', res.status, res.data.error);
  }

  if (testIds.employee) {
    res = await request('PUT', `/employees/${testIds.employee}`, {
      name: 'Empleado Actualizado',
    });
    log(res.status === 200 ? 'PASS' : 'FAIL', 'PUT /employees/:id', res.status, res.data.error);

    res = await request('DELETE', `/employees/${testIds.employee}`);
    log(res.status === 200 ? 'PASS' : 'FAIL', 'DELETE /employees/:id', res.status, res.data.error);
  }

  await sleep(300);

  // ============= CITAS =============
  console.log(`\n${colors.yellow}━━━ CITAS ━━━${colors.reset}`);

  res = await request('GET', '/appointments');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /appointments', res.status, res.data.error);

  if (testIds.client && testIds.service) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const appointmentDateTime = tomorrow.toISOString().slice(0, 16) + ':00Z';

    res = await request('POST', '/appointments', {
      client_id: testIds.client,
      service_id: testIds.service,
      scheduled_at: appointmentDateTime,
      price: 25000,
    });

    if (res.status === 201) {
      testIds.appointment = res.data.data?.id;
      log('PASS', 'POST /appointments', res.status);
    } else {
      log('FAIL', 'POST /appointments', res.status, res.data.error);
    }

    if (testIds.appointment) {
      res = await request('PATCH', `/appointments/${testIds.appointment}`, {
        status: 'confirmed',
      });
      log(res.status === 200 ? 'PASS' : 'FAIL', 'PATCH /appointments/:id', res.status, res.data.error);

      res = await request('DELETE', `/appointments/${testIds.appointment}`);
      log(res.status === 200 ? 'PASS' : 'FAIL', 'DELETE /appointments/:id', res.status, res.data.error);
    }
  }

  if (testIds.service) {
    res = await request('DELETE', `/services/${testIds.service}`);
    log(res.status === 200 ? 'PASS' : 'FAIL', 'DELETE /services/:id', res.status, res.data.error);
  }

  await sleep(300);

  // ============= PRODUCTOS =============
  console.log(`\n${colors.yellow}━━━ PRODUCTOS ━━━${colors.reset}`);

  res = await request('GET', '/products');
  if (res.status !== 200) {
    log('FAIL', 'GET /products', res.status, res.data.error || JSON.stringify(res.data).substring(0, 100));
  } else {
    log('PASS', 'GET /products', res.status);
  }

  res = await request('POST', '/products', {
    name: 'Producto Prueba',
    price: 15000,
    quantity: 10,
  });

  if (res.status === 201) {
    testIds.product = res.data.data?.id;
    log('PASS', 'POST /products', res.status);
  } else {
    log('FAIL', 'POST /products', res.status, res.data.error);
  }

  if (testIds.product) {
    res = await request('PUT', `/products/${testIds.product}/toggle`, {});
    log(res.status === 200 ? 'PASS' : 'FAIL', 'PUT /products/:id/toggle', res.status, res.data.error);
  } else {
    log('FAIL', 'PUT /products/:id/toggle', 0, 'No product ID available');
  }

  await sleep(300);

  // ============= CAJA =============
  console.log(`\n${colors.yellow}━━━ CAJA ━━━${colors.reset}`);

  res = await request('GET', '/cash/summary?period=day');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /cash/summary', res.status, res.data.error);

  res = await request('GET', '/cash/income?period=month');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /cash/income', res.status, res.data.error);

  res = await request('GET', '/cash/expenses?period=month');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /cash/expenses', res.status, res.data.error);

  res = await request('POST', '/cash/income', {
    amount: 50000,
    category: 'servicios',
    description: 'Ingreso prueba',
    date: new Date().toISOString().split('T')[0],
  });
  log(res.status === 201 ? 'PASS' : 'FAIL', 'POST /cash/income', res.status, res.data.error);

  res = await request('POST', '/cash/expenses', {
    amount: 10000,
    category: 'materias_primas',
    description: 'Egreso prueba',
    date: new Date().toISOString().split('T')[0],
  });
  log(res.status === 201 ? 'PASS' : 'FAIL', 'POST /cash/expenses', res.status, res.data.error);

  await sleep(300);

  // ============= MÉTRICAS =============
  console.log(`\n${colors.yellow}━━━ MÉTRICAS ━━━${colors.reset}`);

  res = await request('GET', '/metrics/overview');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /metrics/overview', res.status, res.data.error);

  res = await request('GET', '/metrics/employees');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /metrics/employees', res.status, res.data.error);

  res = await request('GET', '/metrics/retention');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /metrics/retention', res.status, res.data.error);

  await sleep(300);

  // ============= CONFIGURACIÓN =============
  console.log(`\n${colors.yellow}━━━ CONFIGURACIÓN ━━━${colors.reset}`);

  res = await request('GET', '/settings/hours');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /settings/hours', res.status, res.data.error);

  res = await request('GET', '/settings/profile');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /settings/profile', res.status, res.data.error);

  res = await request('GET', '/alerts');
  log(res.status === 200 ? 'PASS' : 'FAIL', 'GET /alerts', res.status, res.data.error);

  console.log(`\n${colors.yellow}✅ Tests completados${colors.reset}\n`);
}

runTests().catch(console.error);
