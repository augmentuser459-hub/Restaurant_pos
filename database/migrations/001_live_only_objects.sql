-- ============================================
-- 001: Objects that exist in the original production database but in no other SQL file.
-- Found with read-only probes of production (2026-10-21). Idempotent.
-- ============================================

ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_kitchen BOOLEAN DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branch_pos_items_branch_id_item_id_key') THEN
    ALTER TABLE branch_pos_items ADD CONSTRAINT branch_pos_items_branch_id_item_id_key UNIQUE (branch_id, item_id);
  END IF;
END $$;

-- Realtime change feed used by the kitchen screen and notifications.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'notifications'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
