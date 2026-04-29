-- Enable RLS on subprimal_prices (omitted from original table creation migration)
ALTER TABLE public.subprimal_prices ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read
CREATE POLICY "auth_read_subprimal_prices"
  ON public.subprimal_prices FOR SELECT TO authenticated USING (true);

-- Anon users can read (consistent with other dashboard data tables)
CREATE POLICY "anon_read_subprimal_prices"
  ON public.subprimal_prices FOR SELECT TO anon USING (true);

-- service_role bypasses RLS entirely — no INSERT/UPDATE/DELETE policies needed.
