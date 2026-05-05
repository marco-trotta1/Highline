CREATE TABLE signal_snapshots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp timestamptz NOT NULL DEFAULT now(),
  direction text NOT NULL CHECK (direction IN ('Bullish','Neutral','Bearish')),
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  futures_price numeric,
  futures_change_pct numeric,
  futures_weight numeric DEFAULT 0.45,
  futures_signal numeric,
  negotiated_weighted_avg numeric,
  negotiated_volume_loads integer,
  negotiated_session_quality text,
  negotiated_weight numeric DEFAULT 0.35,
  negotiated_signal numeric,
  cold_storage_vs_5yr_avg_pct numeric,
  cold_storage_weight numeric DEFAULT 0.20,
  cold_storage_signal numeric,
  composite_score numeric,
  notes text
);

CREATE INDEX ON signal_snapshots (timestamp DESC);

ALTER TABLE signal_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read" ON signal_snapshots FOR SELECT USING (true);
