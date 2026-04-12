-- Phase 2 — Dashboard RLS + Realtime setup
--
-- Phase 1 granted SELECT only to `authenticated`. The browser dashboard uses
-- the anon key so it needs explicit anon SELECT policies. The data is public
-- USDA/CME market data; no PII.
--
-- Also adds the three "live-ish" tables to the supabase_realtime publication
-- so that postgres_changes events broadcast to subscribed clients. Slaughter
-- and cold storage update weekly/monthly respectively and don't need push.

CREATE POLICY "anon_read_cutout_daily"
  ON cutout_daily FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_negotiated_sales"
  ON negotiated_sales FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_slaughter_weekly"
  ON slaughter_weekly FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_cold_storage_monthly"
  ON cold_storage_monthly FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_futures_snapshots"
  ON futures_snapshots FOR SELECT TO anon USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE cutout_daily;
ALTER PUBLICATION supabase_realtime ADD TABLE negotiated_sales;
ALTER PUBLICATION supabase_realtime ADD TABLE futures_snapshots;
