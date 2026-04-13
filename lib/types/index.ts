export interface NegotiatedSalesRecord {
  date: string; // ISO 8601 date, e.g. "2026-04-10"
  session: 'AM' | 'PM';
  low: number;
  high: number;
  weighted_avg: number;
  volume_loads: number;
  session_quality: 'active' | 'thin';
  source_hash: string;
}

export interface SlaughterRecord {
  week_ending: string; // ISO 8601 date
  total_head: number;
  steer_count: number;
  heifer_count: number;
  steer_heifer_ratio: number; // steer_count / (steer_count + heifer_count)
  source_hash: string;
}

export interface ColdStorageRecord {
  month: number; // 1–12
  year: number;
  total_beef_million_lbs: number;
  vs_5yr_avg_pct: number;
  source_hash: string;
}

export interface CutoutRecord {
  date: string; // ISO 8601 date
  report_type: string; // e.g. "LM_XB459", "Daily"
  choice_total: number;
  select_total: number;
  choice_select_spread: number; // choice_total - select_total
  chuck: number;
  rib: number;
  loin: number;
  round: number;
  brisket: number;
  short_plate: number;
  flank: number;
  source_hash: string;
}

export interface FuturesSnapshot {
  timestamp: string; // ISO 8601 datetime
  front_month_contract: string; // e.g. "LCM26"
  front_month_price: number;
  change_today: number;
  change_pct: number;
  source: string; // default: 'agribeef_scrape'
}

export interface IngestionLogEntry {
  source: string;
  timestamp: string; // ISO 8601 datetime
  source_hash: string | null;
  status: 'success' | 'failed' | 'duplicate';
  error_message: string | null;
  records_inserted: number;
}

export interface ValidationError {
  field: string;
  value: unknown;
  reason: string;
}

export interface ParserResult<TRecord, TRaw> {
  parsedRecord: TRecord;
  rawExtractedContent: TRaw;
  sha256: string;
}

export class SourceFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class ValidationFailureError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: ValidationError[] = []
  ) {
    super(message);
    this.name = 'ValidationFailureError';
  }
}

// Supabase row shapes (what comes back from the DB)
export interface CutoutDailyRow extends CutoutRecord {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface NegotiatedSalesRow extends NegotiatedSalesRecord {
  id: string;
  created_at: string;
}

export interface SlaughterWeeklyRow extends SlaughterRecord {
  id: string;
  created_at: string;
}

export interface ColdStorageMonthlyRow extends ColdStorageRecord {
  id: string;
  created_at: string;
}

export interface FuturesSnapshotRow extends FuturesSnapshot {
  id: string;
  created_at: string;
}

export interface DataHealthStatus {
  source: string;
  state: 'fresh' | 'stale' | 'no_data' | 'error';
  last_updated: string | null;
  stale: boolean;
  stale_reason: string | null;
  error_message: string | null;
}

export type MarketTone = 'bull' | 'neutral' | 'bear';

export interface MarketDriverSignal {
  key: 'futures' | 'negotiated' | 'cold_storage';
  label: string;
  tone: MarketTone;
  score: number;
  weight: number;
  detail: string;
}

export interface MarketDirectionSignal {
  tone: MarketTone;
  confidence_pct: number;
  confidence_label: 'low' | 'medium' | 'high';
  score: number;
  summary: string;
  drivers: MarketDriverSignal[];
}

export interface BidRangeCalculatorContext {
  benchmark_price: number | null;
  negotiated_anchor: number | null;
  cutout_anchor: number | null;
  spread_to_cutout: number | null;
  latest_session: 'AM' | 'PM' | null;
  latest_session_quality: 'active' | 'thin' | null;
  market_tone: MarketTone;
  market_confidence_label: 'low' | 'medium' | 'high';
}

export interface BidRangeInput {
  grade: 'standard' | 'choice' | 'choice-plus' | 'prime-capable';
  brand: 'commodity' | 'program' | 'natural' | 'branded';
  channel: 'cash' | 'formula' | 'grid' | 'program';
  weight_lbs: number;
}

export interface BidRangeOutput {
  benchmark: number;
  midpoint: number;
  low: number;
  high: number;
  adjustments: Array<{
    label: string;
    amount: number;
  }>;
}

// Everything the dashboard Server Component fetches in one shot.
export interface DashboardSnapshot {
  cutout: {
    latest: CutoutDailyRow | null;
    yesterday: CutoutDailyRow | null;
  };
  negotiated: {
    today: NegotiatedSalesRow[];
  };
  futures: {
    latest: FuturesSnapshotRow | null;
  };
  slaughter: {
    latest: SlaughterWeeklyRow | null;
    fourWeekAvgHeiferPct: number | null;
  };
  coldStorage: {
    latest: ColdStorageMonthlyRow | null;
    history: ColdStorageMonthlyRow[];
  };
  market: {
    direction: MarketDirectionSignal | null;
    calculator: BidRangeCalculatorContext;
  };
  health: DataHealthStatus[];
  fetchedAt: string;
}
