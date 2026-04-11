-- Enable RLS on all tables
ALTER TABLE cutout_daily          ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiated_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE slaughter_weekly      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_storage_monthly  ENABLE ROW LEVEL SECURITY;
ALTER TABLE futures_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_log         ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT from all tables
CREATE POLICY "auth_read_cutout_daily"
  ON cutout_daily FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_negotiated_sales"
  ON negotiated_sales FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_slaughter_weekly"
  ON slaughter_weekly FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_cold_storage_monthly"
  ON cold_storage_monthly FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_futures_snapshots"
  ON futures_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_ingestion_log"
  ON ingestion_log FOR SELECT TO authenticated USING (true);

-- NOTE: The service_role key bypasses RLS entirely in Supabase.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY, so no explicit
-- INSERT/UPDATE/DELETE policies are needed for them.
-- Anon users have no access (no anon policies defined).
