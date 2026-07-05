-- ============================================================
-- FIX: recall_logs FK missing ON DELETE CASCADE
-- ============================================================
-- The original FK in 034_recall_logs.sql was:
--   client_id UUID REFERENCES clients(id)
--
-- This prevented any DELETE on clients if the client had
-- received a recall_log (FK 23503 violation). This fix adds
-- ON DELETE CASCADE so that deleting a client also deletes
-- its recall_logs (makes sense — no client to recall anymore).

ALTER TABLE recall_logs
DROP CONSTRAINT IF EXISTS recall_logs_client_id_fkey;

ALTER TABLE recall_logs
ADD CONSTRAINT recall_logs_client_id_fkey
  FOREIGN KEY (client_id)
  REFERENCES clients(id)
  ON DELETE CASCADE;
