-- The dashboard reads ingestion timestamps in the browser to show data freshness.
-- The table contains operational USDA/CME ingest metadata only, not private data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ingestion_log'
      AND policyname = 'anon_read_ingestion_log'
  ) THEN
    CREATE POLICY "anon_read_ingestion_log"
      ON public.ingestion_log FOR SELECT TO anon USING (true);
  END IF;
END;
$$;
