const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL) throw new Error('Missing required env var: SUPABASE_URL');
if (!process.env.SUPABASE_ANON_KEY) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');

const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function createUserClient(authHeader) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );
}

module.exports = { supabaseClient, supabaseAdmin, createUserClient };
