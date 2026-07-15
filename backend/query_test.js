const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://hzunrqgbrpqgqspprmim.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6dW5ycWdicnBxZ3FzcHBybWltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMDM5MzM5NiwiZXhwIjoyMDQ1OTY5Mzk2fQ.CJl-8PpkE1wLp-c3WUahGKJiMZmI3D8Q9FMf-GazpAM'
);

async function queryAppointments() {
  const businessId = 'd26bc18e-bbcf-4ca3-bba3-d66d1025132f';

  const now = new Date();
  const colombiaTime = now.toLocaleString('en-CA', { timeZone: 'America/Bogota' });
  console.log('Current time (Colombia):', colombiaTime);

  const { data, error } = await supabase
    .from('appointments')
    .select('id, employee_id, scheduled_at, status, service_id, created_at, clients(name), employees(name), services(name)')
    .eq('business_id', businessId)
    .order('scheduled_at');

  if (error) {
    console.error('Query error:', error);
    return;
  }

  console.log('\nAll appointments for Barbería Test:');
  console.log('=====================================');
  console.log(`Total: ${data.length} appointments\n`);

  data.forEach((appt) => {
    const scheduledDate = new Date(appt.scheduled_at);
    const localTime = scheduledDate.toLocaleString('en-CA', { timeZone: 'America/Bogota' });
    console.log(`ID: ${appt.id}`);
    console.log(`  Scheduled (UTC): ${appt.scheduled_at}`);
    console.log(`  Scheduled (Colombia): ${localTime}`);
    console.log(`  Employee: ${appt.employees?.name || 'N/A'} (${appt.employee_id})`);
    console.log(`  Service: ${appt.services?.name || 'N/A'}`);
    console.log(`  Client: ${appt.clients?.name || 'N/A'}`);
    console.log(`  Status: ${appt.status}`);
    console.log(`  Created: ${appt.created_at}`);
    console.log('---');
  });
}

queryAppointments().catch(console.error);
