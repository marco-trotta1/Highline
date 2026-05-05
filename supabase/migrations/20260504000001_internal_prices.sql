CREATE TABLE internal_prices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date date NOT NULL,
  primal text NOT NULL CHECK (primal IN ('chuck','rib','loin','round','brisket','short_plate','flank')),
  brand text NOT NULL DEFAULT 'AB',
  grade text NOT NULL CHECK (grade IN ('Choice','Select','Prime')),
  channel text NOT NULL CHECK (channel IN ('fresh','frozen')),
  price_cwt numeric NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(date, primal, brand, grade, channel)
);

CREATE INDEX ON internal_prices (date DESC, primal);

-- RLS: allow anon read, require service role for write
ALTER TABLE internal_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read" ON internal_prices FOR SELECT USING (true);
