const { supabaseAdmin } = require('./src/config/supabase');

(async () => {
  console.log('=== BACKFILL: Generar income faltante para 10 citas confirmed ===\n');

  try {
    // Step 1: Fetch affected appointments
    console.log('📋 STEP 1: Fetching affected appointments...\n');
    const { data: affectedAppts, error: fetchError } = await supabaseAdmin
      .from('appointments')
      .select('id, service_id, price, scheduled_at, business_id, source, client_id, services(name)')
      .eq('status', 'confirmed')
      .lt('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(100);

    if (fetchError) {
      console.error('❌ Error fetching appointments:', fetchError.message);
      process.exit(1);
    }

    // Filter: only those without income
    const toProcess = [];
    for (const appt of affectedAppts || []) {
      const { data: income } = await supabaseAdmin
        .from('income')
        .select('id')
        .eq('appointment_id', appt.id)
        .maybeSingle();

      if (!income) {
        toProcess.push(appt);
      }
    }

    console.log(`Found ${toProcess.length} affected appointments:\n`);
    console.log('ID                                   | Service        | Price    | Scheduled At');
    console.log('-'.repeat(100));
    for (const appt of toProcess) {
      const serviceStr = (appt.services?.name || 'Unknown').padEnd(14);
      const priceStr = (appt.price || 0).toString().padEnd(8);
      const dateStr = new Date(appt.scheduled_at).toLocaleString('es-CO');
      console.log(`${appt.id.padEnd(36)} | ${serviceStr} | ${priceStr} | ${dateStr}`);
    }

    if (toProcess.length === 0) {
      console.log('\n✓ No affected appointments found. Exiting.');
      process.exit(0);
    }

    // Step 2: Update appointments and create income
    console.log(`\n📝 STEP 2: Updating ${toProcess.length} appointments to completed & creating income...\n`);

    let successCount = 0;
    let failedAppts = [];
    let totalIncomeGenerated = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const appt = toProcess[i];
      const apptNum = i + 1;

      try {
        // Update appointment status
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('appointments')
          .update({ status: 'completed' })
          .eq('id', appt.id)
          .eq('business_id', appt.business_id)
          .select('id');

        if (updateError || !updateData || updateData.length === 0) {
          throw new Error(`Failed to update appointment status: ${updateError?.message || 'No rows affected'}`);
        }

        // Create income
        const canalLabel = appt.source === 'whatsapp'
          ? 'agendado por WhatsApp'
          : appt.source === 'assistant'
            ? 'agendado por Asistente IA'
            : 'agendado manualmente';

        const { data: incomeData, error: incomeError } = await supabaseAdmin
          .from('income')
          .insert({
            business_id: appt.business_id,
            appointment_id: appt.id,
            client_id: appt.client_id || null,
            amount: appt.price || 0,
            category: 'servicios',
            description: `${appt.services?.name || 'Servicio'} - ${canalLabel} (backfilled)`,
            source: 'appointment',
            date: new Date(appt.scheduled_at).toISOString().split('T')[0]
          })
          .select('id');

        if (incomeError || !incomeData || incomeData.length === 0) {
          throw new Error(`Failed to create income: ${incomeError?.message || 'No rows affected'}`);
        }

        console.log(`  ✓ [${apptNum}/${toProcess.length}] ${appt.id}: completed + income $${(appt.price || 0).toLocaleString('es-CO')}`);
        successCount++;
        totalIncomeGenerated += appt.price || 0;

      } catch (error) {
        console.error(`  ❌ [${apptNum}/${toProcess.length}] ${appt.id}: ${error.message}`);
        failedAppts.push({ id: appt.id, error: error.message });
      }
    }

    // Step 3: Verify results
    console.log(`\n✅ STEP 3: Verification\n`);
    console.log(`Processed: ${successCount}/${toProcess.length}`);
    console.log(`Total income generated: $${totalIncomeGenerated.toLocaleString('es-CO')} COP\n`);

    if (failedAppts.length > 0) {
      console.error(`⚠️  Failed appointments (${failedAppts.length}):`);
      for (const f of failedAppts) {
        console.error(`   - ${f.id}: ${f.error}`);
      }
      process.exit(1);
    }

    // Final verification query
    console.log('📊 Final verification: checking completed status...\n');
    const { data: completed, error: verifyError } = await supabaseAdmin
      .from('appointments')
      .select('id, status')
      .in('id', toProcess.map(a => a.id));

    if (verifyError) {
      console.error('Error verifying:', verifyError.message);
      process.exit(1);
    }

    const allCompleted = (completed || []).every(a => a.status === 'completed');
    if (allCompleted) {
      console.log(`✓ All ${completed?.length} appointments now have status='completed'\n`);
    } else {
      console.error('⚠️  Some appointments still have wrong status!');
      process.exit(1);
    }

    console.log('=== BACKFILL COMPLETE ===\n');

  } catch (error) {
    console.error('Unexpected error:', error.message);
    process.exit(1);
  }
})();
