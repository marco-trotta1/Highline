-- Enforce the Phase 1 table security contract on live projects that may have
-- drifted from the repo migrations:
-- - RLS enabled on all required tables
-- - authenticated SELECT allowed on all required tables
-- - no anon/authenticated INSERT/UPDATE/DELETE policies on required tables
-- - anon SELECT preserved for the dashboard tables introduced in Phase 2
-- - realtime publication preserved for the live-ish tables

ALTER TABLE public.cutout_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negotiated_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_storage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.futures_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'cutout_daily',
        'negotiated_sales',
        'slaughter_weekly',
        'cold_storage_monthly',
        'futures_snapshots',
        'ingestion_log'
      )
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      target.policyname,
      target.schemaname,
      target.tablename
    );
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cutout_daily'
      AND policyname = 'auth_read_cutout_daily'
  ) THEN
    CREATE POLICY "auth_read_cutout_daily"
      ON public.cutout_daily FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'negotiated_sales'
      AND policyname = 'auth_read_negotiated_sales'
  ) THEN
    CREATE POLICY "auth_read_negotiated_sales"
      ON public.negotiated_sales FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'slaughter_weekly'
      AND policyname = 'auth_read_slaughter_weekly'
  ) THEN
    CREATE POLICY "auth_read_slaughter_weekly"
      ON public.slaughter_weekly FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cold_storage_monthly'
      AND policyname = 'auth_read_cold_storage_monthly'
  ) THEN
    CREATE POLICY "auth_read_cold_storage_monthly"
      ON public.cold_storage_monthly FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'futures_snapshots'
      AND policyname = 'auth_read_futures_snapshots'
  ) THEN
    CREATE POLICY "auth_read_futures_snapshots"
      ON public.futures_snapshots FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ingestion_log'
      AND policyname = 'auth_read_ingestion_log'
  ) THEN
    CREATE POLICY "auth_read_ingestion_log"
      ON public.ingestion_log FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cutout_daily'
      AND policyname = 'anon_read_cutout_daily'
  ) THEN
    CREATE POLICY "anon_read_cutout_daily"
      ON public.cutout_daily FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'negotiated_sales'
      AND policyname = 'anon_read_negotiated_sales'
  ) THEN
    CREATE POLICY "anon_read_negotiated_sales"
      ON public.negotiated_sales FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'slaughter_weekly'
      AND policyname = 'anon_read_slaughter_weekly'
  ) THEN
    CREATE POLICY "anon_read_slaughter_weekly"
      ON public.slaughter_weekly FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cold_storage_monthly'
      AND policyname = 'anon_read_cold_storage_monthly'
  ) THEN
    CREATE POLICY "anon_read_cold_storage_monthly"
      ON public.cold_storage_monthly FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'futures_snapshots'
      AND policyname = 'anon_read_futures_snapshots'
  ) THEN
    CREATE POLICY "anon_read_futures_snapshots"
      ON public.futures_snapshots FOR SELECT TO anon USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cutout_daily'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cutout_daily;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'negotiated_sales'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.negotiated_sales;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'futures_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.futures_snapshots;
  END IF;
END
$$;
