require('dotenv').config({ path: '.env' });
const { supabaseAdmin } = require('./src/config/supabase');

(async () => {
  try {
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('id, name, price, duration_minutes')
      .eq('business_id', 'd26bc18e-bbcf-4ca3-bba3-d66d1025132f')
      .eq('active', true)
      .order('name');

    if (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }

    console.log('=== SERVICIOS DE BARBERÍA TEST ===\n');
    data.forEach(s => console.log(`- ${s.name} ($${s.price}, ${s.duration_minutes}min)`));
    console.log(`\nTotal: ${data.length} servicios`);
    process.exit(0);
  } catch (e) {
    console.error('Exception:', e.message);
    process.exit(1);
  }
})();
