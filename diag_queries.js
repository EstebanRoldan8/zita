const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, 'zita', 'backend', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) {
    env[key.trim()] = value.trim().replace(/^['"]|['"]$/g, '');
  }
});

const { createClient } = require('./zita/backend/node_modules/@supabase/supabase-js');
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    console.log('=== QUERY 1: whatsapp_conversations for 573183790317 ===');
    const { data: q1, error: e1 } = await sb
      .from('whatsapp_conversations')
      .select('id, business_id, client_phone, bot_paused_until, last_message_at')
      .eq('client_phone', '573183790317')
      .order('last_message_at', { ascending: false })
      .limit(5);

    if (e1) console.error('Error Q1:', e1);
    else console.log(JSON.stringify(q1, null, 2));

    console.log('\n=== QUERY 2: businesses with id d26bc18e-bbcf-4ca3-bba3-d66d1025132f ===');
    const { data: q2, error: e2 } = await sb
      .from('businesses')
      .select('id, name, whatsapp_phone_number_id')
      .eq('id', 'd26bc18e-bbcf-4ca3-bba3-d66d1025132f')
      .single();

    if (e2) console.error('Error Q2:', e2);
    else console.log(JSON.stringify(q2, null, 2));

    console.log('\n=== Query 3: Check phoneNumberId in webhook ===');
    console.log('Need to add logger to webhook.controller.js line 44-45 to see phoneNumberId value');

  } catch (err) {
    console.error('Fatal error:', err.message);
  }

  process.exit(0);
})();
