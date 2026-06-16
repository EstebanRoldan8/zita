const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkPause() {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("client_phone, bot_paused_until, last_bot_response_at")
    .eq("client_phone", "573183790317")
    .maybeSingle();

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }

  console.log("Conversation data:", JSON.stringify(data, null, 2));
  
  if (data?.bot_paused_until) {
    const pausedUntil = new Date(data.bot_paused_until);
    const now = new Date();
    const isPaused = pausedUntil > now;
    console.log("\nPause Status:");
    console.log("  Paused until:", pausedUntil.toISOString());
    console.log("  Current time:", now.toISOString());
    console.log("  Is currently paused:", isPaused);
    console.log("  Minutes remaining:", Math.ceil((pausedUntil - now) / 1000 / 60));
  } else {
    console.log("\nNo pause set for this client");
  }

  process.exit(0);
}

checkPause();
