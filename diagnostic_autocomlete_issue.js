const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function diagnoseBug() {
  console.log('=== DIAGNOSTIC: autoCompleteAppointments Bug (guard .eq pending vs .in pending/confirmed) ===\n');

  try {
    // Get all confirmed appointments with scheduled_at in the past that have no income
    const { data: affectedAppts, error: apptError } = await supabase
      .from('appointments')
      .select('id, business_id, price, scheduled_at, status, source')
      .eq('status', 'confirmed')
      .lt('scheduled_at', new Date().toISOString())
      .limit(5000);

    if (apptError) {
      console.error('Error fetching appointments:', apptError.message);
      process.exit(1);
    }

    // For each appointment, check if it has income
    let affectedCount = 0;
    let totalMissingIncome = 0;
    let earliestDate = null;
    let latestDate = null;
    const businessesAffected = new Set();

    for (const appt of affectedAppts || []) {
      const { data: incomeCheck } = await supabase
        .from('income')
        .select('id')
        .eq('appointment_id', appt.id)
        .maybeSingle();

      if (!incomeCheck) {
        // No income found - this is an affected appointment
        affectedCount++;
        totalMissingIncome += appt.price || 0;
        businessesAffected.add(appt.business_id);

        if (!earliestDate || new Date(appt.scheduled_at) < new Date(earliestDate)) {
          earliestDate = appt.scheduled_at;
        }
        if (!latestDate || new Date(appt.scheduled_at) > new Date(latestDate)) {
          latestDate = appt.scheduled_at;
        }
      }
    }

    console.log('📊 AFFECTED CITAS (confirmed, past, no income):\n');
    console.log(`   Total count:          ${affectedCount}`);
    console.log(`   Total missing income: $${totalMissingIncome.toLocaleString('es-CO')} COP`);
    console.log(`   Affected businesses:  ${businessesAffected.size}`);
    console.log(`   Earliest affected:    ${earliestDate ? new Date(earliestDate).toLocaleString('es-CO') : 'N/A'}`);
    console.log(`   Latest affected:      ${latestDate ? new Date(latestDate).toLocaleString('es-CO') : 'N/A'}`);
    console.log(`   Date range:           ${earliestDate && latestDate ? Math.floor((new Date(latestDate) - new Date(earliestDate)) / (1000 * 60 * 60 * 24)) + ' days' : 'N/A'}`);

    console.log('\n💡 INTERPRETATION:\n');
    console.log(`   - ${affectedCount} confirmed citas in the past should have auto-completed but didn't`);
    console.log(`   - These ${affectedCount} citas are missing income records worth $${totalMissingIncome.toLocaleString('es-CO')}`);
    console.log(`   - The bug was introduced in today's scheduler fix (guard changed to .eq('pending'))`);
    console.log(`   - Estimated impact: Caja is missing ${affectedCount} income entries across ${businessesAffected.size} businesses\n`);

  } catch (error) {
    console.error('Unexpected error:', error.message);
    process.exit(1);
  }
}

diagnoseBug();
