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
  const { data, error } = await sb
    .from('whatsapp_conversations')
    .select('id, business_id, bot_paused_until, last_bot_response_at, last_message_at')
    .eq('client_phone', '573183790317')
    .maybeSingle();

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  if (!data) {
    console.log('No record found');
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
  process.exit(0);
})();
