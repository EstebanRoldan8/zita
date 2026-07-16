const { supabaseAdmin } = require('./src/config/supabase');

async function diagnose() {
  const businessId = 'd26bc18e-bbcf-4ca3-bba3-d66d1025132f';

  console.log('\n=== BARBERÍA TEST DIAGNOSIS ===\n');

  // 1. Active employees
  const { data: employees, error: empErr } = await supabaseAdmin
    .from('employees')
    .select('id, name, is_active')
    .eq('business_id', businessId)
    .order('name');

  if (empErr) {
    console.error('Error fetching employees:', empErr.message);
    return;
  }

  console.log(`EMPLEADOS ACTIVOS: ${employees.filter(e => e.is_active).length}`);
  console.log('---');
  employees.forEach(e => {
    console.log(`  ${e.is_active ? '✓' : '✗'} ${e.name} (${e.id})`);
  });

  // 2. Appointments without employee_id
  const { data: apptNoEmp, error: apptErr } = await supabase
    .from('appointments')
    .select('id, scheduled_at, status, service_id, services(name), client_id, clients(name)')
    .eq('business_id', businessId)
    .is('employee_id', null)
    .order('scheduled_at', { ascending: false })
    .limit(10);

  if (apptErr) {
    console.error('Error fetching appointments:', apptErr.message);
    return;
  }

  console.log(`\nCITAS SIN EMPLEADO: ${apptNoEmp?.length || 0}`);
  console.log('---');
  if (apptNoEmp && apptNoEmp.length > 0) {
    apptNoEmp.slice(0, 5).forEach(a => {
      const fecha = new Date(a.scheduled_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      console.log(`  ${fecha} | ${a.services?.name || 'N/A'} | Cliente: ${a.clients?.name || 'N/A'} | Status: ${a.status}`);
    });
  }

  // 3. Recent appointments with employee_id
  const { data: apptWithEmp, error: apptErr2 } = await supabase
    .from('appointments')
    .select('id, scheduled_at, status, employee_id, service_id, services(name), employees(name), clients(name)')
    .eq('business_id', businessId)
    .not('employee_id', 'is', null)
    .order('scheduled_at', { ascending: false })
    .limit(10);

  if (apptErr2) {
    console.error('Error fetching appointments with employee:', apptErr2.message);
    return;
  }

  console.log(`\nCITAS CON EMPLEADO (últimas 10):`);
  console.log('---');
  if (apptWithEmp && apptWithEmp.length > 0) {
    apptWithEmp.forEach(a => {
      const fecha = new Date(a.scheduled_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      console.log(`  ${fecha} | ${a.services?.name || 'N/A'} | Empleado: ${a.employees?.name || 'N/A'} | Status: ${a.status}`);
    });
  }

  // 4. Check foreign key constraints on appointments.employee_id
  console.log('\nCHECKING FOREIGN KEY CONSTRAINTS...');
  console.log('(Si employee_id = NULL, probablemente hay ON DELETE SET NULL)');
}

diagnose().catch(console.error);
