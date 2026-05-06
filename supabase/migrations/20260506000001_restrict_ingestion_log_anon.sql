-- Keep ingestion status details behind the app access gate.
-- The dashboard now reads these rows through /api/ingestion-health with
-- the service role key, so anon direct reads are no longer needed.
DROP POLICY IF EXISTS "anon_read_ingestion_log" ON public.ingestion_log;
