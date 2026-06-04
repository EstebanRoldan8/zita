const { createClient } = require('@supabase/supabase-js');

let _supabaseClient;
let _supabaseAdmin;

function getSupabaseClient() {
  if (!_supabaseClient) {
    if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL env var is required');
    _supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  }
  return _supabaseClient;
}

function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL env var is required');
    _supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseAdmin;
}

function createUserClient(authHeader) {
  if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL env var is required');
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    }
  );
}

module.exports = {
  get supabaseClient() { return getSupabaseClient(); },
  get supabaseAdmin() { return getSupabaseAdmin(); },
  createUserClient,
};
