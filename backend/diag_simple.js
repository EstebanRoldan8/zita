const SUPABASE_URL = 'https://hzunrqgbrpqgqspprmim.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6dW5ycWdicnBxZ3FzcHBybWltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMDM5MzM5NiwiZXhwIjoyMDQ1OTY5Mzk2fQ.CJl-8PpkE1wLp-c3WUahGKJiMZmI3D8Q9FMf-GazpAM';

async function query(table, select, filters = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;

  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      url += `&${key}=in.(${value.map(v => `"${v}"`).join(',')})`;
    } else if (value === null) {
      url += `&${key}=is.null`;
    } else if (value === 'not-null') {
      url += `&${key}=not.is.null`;
    } else {
      url += `&${key}=eq.${encodeURIComponent(value)}`;
    }
  }

  url += '&order=name.asc';

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    }
  });

  if (!res.ok) {
    console.error(`Error (${res.status}):`, await res.text());
    return null;
  }

  return await res.json();
}

async function diagnose() {
  const businessId = 'd26bc18e-bbcf-4ca3-bba3-d66d1025132f';

  console.log('\n=== BARBERÍA TEST DIAGNOSIS ===\n');

  // 1. Active employees
  const employees = await query('employees', 'id,name,is_active', { business_id: businessId });
  console.log(`EMPLEADOS: ${employees?.length || 0}`);
  console.log('---');
  employees?.forEach(e => {
    console.log(`  ${e.is_active ? '✓' : '✗'} ${e.name} (${e.id.substring(0, 8)}...)`);
  });

  // 2. Appointments without employee
  const apptNoEmp = await query(
    'appointments',
    'id,scheduled_at,status',
    { business_id: businessId, employee_id: null }
  );
  console.log(`\nCITAS SIN EMPLEADO: ${apptNoEmp?.length || 0}`);
  if (apptNoEmp && apptNoEmp.length > 0) {
    console.log('---');
    apptNoEmp.slice(0, 3).forEach(a => {
      const fecha = new Date(a.scheduled_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      console.log(`  ${fecha} | Status: ${a.status}`);
    });
  }

  // 3. All appointments count
  const allAppt = await query(
    'appointments',
    'id',
    { business_id: businessId }
  );
  console.log(`\nTOTAL DE CITAS: ${allAppt?.length || 0}`);
}

diagnose().catch(console.error);
