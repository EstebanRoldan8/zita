const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Execute complete GDPR deletion of a client.
 * This is a real, permanent DELETE operation — NOT soft-delete (archived=true).
 * Used by admin endpoint only after manual verification of GDPR request.
 *
 * Deletion order respects FK dependencies:
 *   1. recall_logs (FK to clients, now has ON DELETE CASCADE)
 *   2. whatsapp_conversations (no FK, searched by phone + business_id)
 *   3. bot_daily_message_counts (no FK, searched by phone + business_id)
 *   4. orders (anonimized, not deleted — for accounting/tax records)
 *   5. clients (final DELETE, cascades to other tables with ON DELETE CASCADE)
 *
 * Returns summary of deleted/anonimized rows for audit trail.
 */
async function gdprDeleteClient(clientIdOrPhone, businessId) {
  const deletionLog = {
    timestamp: new Date().toISOString(),
    recall_logs_deleted: 0,
    whatsapp_conversations_deleted: 0,
    bot_daily_message_counts_deleted: 0,
    orders_anonimized: 0,
    client_deleted: false,
    errors: [],
  };

  try {
    // Determine if input is a UUID (client_id) or phone number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      clientIdOrPhone
    );
    let clientId = null;
    let clientPhone = null;

    if (isUUID) {
      clientId = clientIdOrPhone;
      // Look up phone to also clean whatsapp_conversations + bot_daily_message_counts
      const { data: client, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id, phone')
        .eq('id', clientId)
        .single();

      if (clientError || !client) {
        deletionLog.errors.push(`Client with ID ${clientId} not found`);
        return deletionLog;
      }

      clientPhone = client.phone;
    } else {
      // Input is a phone number — look up client
      clientPhone = clientIdOrPhone;
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('phone', clientPhone)
        .eq('business_id', businessId)
        .maybeSingle();

      if (client) {
        clientId = client.id;
      }
    }

    // Step 1: Delete recall_logs
    if (clientId) {
      const { data: deletedRecallLogs, error: recallError } = await supabaseAdmin
        .from('recall_logs')
        .delete()
        .eq('client_id', clientId)
        .select('id');

      if (recallError) {
        deletionLog.errors.push(`recall_logs deletion failed: ${recallError.message}`);
        return deletionLog;
      }

      deletionLog.recall_logs_deleted = deletedRecallLogs ? deletedRecallLogs.length : 0;
    }

    // Step 2: Delete whatsapp_conversations by phone + business_id
    if (clientPhone && businessId) {
      const { data: deletedConversations, error: convError } = await supabaseAdmin
        .from('whatsapp_conversations')
        .delete()
        .eq('business_id', businessId)
        .eq('client_phone', clientPhone)
        .select('id');

      if (convError) {
        deletionLog.errors.push(
          `whatsapp_conversations deletion failed: ${convError.message}`
        );
        return deletionLog;
      }

      deletionLog.whatsapp_conversations_deleted = deletedConversations
        ? deletedConversations.length
        : 0;
    }

    // Step 3: Delete bot_daily_message_counts by phone + business_id
    if (clientPhone && businessId) {
      const { data: deletedCounts, error: countError } = await supabaseAdmin
        .from('bot_daily_message_counts')
        .delete()
        .eq('business_id', businessId)
        .eq('client_phone', clientPhone)
        .select('id');

      if (countError) {
        deletionLog.errors.push(
          `bot_daily_message_counts deletion failed: ${countError.message}`
        );
        return deletionLog;
      }

      deletionLog.bot_daily_message_counts_deleted = deletedCounts ? deletedCounts.length : 0;
    }

    // Step 4: Anonimize orders (don't delete — needed for accounting/taxes)
    if (clientPhone && businessId) {
      const { data: anonimizedOrders, error: orderError } = await supabaseAdmin
        .from('orders')
        .update({
          client_name: 'Cliente eliminado (GDPR)',
          client_phone: null,
          delivery_address: null,
        })
        .eq('business_id', businessId)
        .eq('client_phone', clientPhone)
        .select('id');

      if (orderError) {
        deletionLog.errors.push(`orders anonimization failed: ${orderError.message}`);
        return deletionLog;
      }

      deletionLog.orders_anonimized = anonimizedOrders ? anonimizedOrders.length : 0;
    }

    // Step 5: Finally DELETE the client row (cascades to other tables)
    if (clientId) {
      const { data: deletedClient, error: clientDeleteError } = await supabaseAdmin
        .from('clients')
        .delete()
        .eq('id', clientId)
        .select('id');

      if (clientDeleteError) {
        deletionLog.errors.push(`clients DELETE failed: ${clientDeleteError.message}`);
        return deletionLog;
      }

      if (deletedClient && deletedClient.length > 0) {
        deletionLog.client_deleted = true;
      } else {
        deletionLog.errors.push('Client row was not deleted (0 affected rows)');
      }
    }

    logger.info(`GDPR deletion completed for client ${clientIdOrPhone}:`, deletionLog);
    return deletionLog;
  } catch (err) {
    logger.error(`gdprDeleteClient unexpected error: ${err.message}`);
    deletionLog.errors.push(`Unexpected error: ${err.message}`);
    return deletionLog;
  }
}

module.exports = {
  gdprDeleteClient,
};
