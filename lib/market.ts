import {
  formatContractName,
  formatCurrency,
  formatDateShort,
  formatSignedCurrency,
  formatSignedPct,
} from './format';
import type {
  BidRangeCalculatorContext,
  BidRangeInput,
  BidRangeOutput,
  ColdStorageMonthlyRow,
  DataHealthStatus,
  FuturesSnapshotRow,
  MarketDirectionSignal,
  MarketDriverSignal,
  MarketTone,
  NegotiatedSalesRow,
} from './types';

const FUTURES_OPEN_MINUTES = 8 * 60 + 30;
const FUTURES_CLOSE_MINUTES = 13 * 60 + 5;
const FUTURES_INTRADAY_STALE_MS = 90 * 60 * 1000;

const GRADE_ADJUSTMENTS: Record<BidRangeInput['grade'], number> = {
  standard: -6,
  choice: 0,
  'choice-plus': 2.5,
  'prime-capable': 5,
};

const BRAND_ADJUSTMENTS: Record<BidRangeInput['brand'], number> = {
  commodity: 0,
  program: 1.5,
  natural: 3,
  branded: 4.5,
};

const CHANNEL_ADJUSTMENTS: Record<BidRangeInput['channel'], number> = {
  cash: 0,
  formula: 1,
  grid: 1.75,
  program: 2.5,
};

const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function chicagoParts(now: Date) {
  const parts = Object.fromEntries(
    chicagoFormatter.formatToParts(now).map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday ?? 'Mon',
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour ?? '0') * 60 + Number(parts.minute ?? '0'),
  };
}

function previousBusinessDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);

  return date.toISOString().slice(0, 10);
}

function isChicagoMarketOpen(now: Date): boolean {
  const parts = chicagoParts(now);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  return (
    parts.minutes >= FUTURES_OPEN_MINUTES &&
    parts.minutes <= FUTURES_CLOSE_MINUTES
  );
}

function expectedFuturesSessionDate(now: Date): string {
  const parts = chicagoParts(now);
  if (parts.weekday === 'Sat') return previousBusinessDate(parts.isoDate);
  if (parts.weekday === 'Sun') return previousBusinessDate(parts.isoDate);
  if (parts.minutes < FUTURES_OPEN_MINUTES) return previousBusinessDate(parts.isoDate);
  return parts.isoDate;
}

function latestNegotiatedPair(rows: NegotiatedSalesRow[]) {
  const sorted = [...rows].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const sessionRankA = a.session === 'PM' ? 2 : 1;
    const sessionRankB = b.session === 'PM' ? 2 : 1;
    return sessionRankB - sessionRankA;
  });

  return {
    latest: sorted[0] ?? null,
    previous: sorted[1] ?? null,
  };
}

function toneFromScore(score: number, threshold = 0.2): MarketTone {
  if (score >= threshold) return 'bull';
  if (score <= -threshold) return 'bear';
  return 'neutral';
}

function toneLabel(tone: MarketTone): string {
  if (tone === 'bull') return 'Bull';
  if (tone === 'bear') return 'Bear';
  return 'Neutral';
}

export function evaluateFuturesHealth(
  source: string,
  probe: { lastUpdated: string | null; errorMessage: string | null },
  now = new Date()
): DataHealthStatus {
  if (probe.errorMessage) {
    return {
      source,
      state: 'error',
      last_updated: null,
      stale: false,
      stale_reason: 'Query failed',
      error_message: probe.errorMessage,
    };
  }

  if (!probe.lastUpdated) {
    return {
      source,
      state: 'no_data',
      last_updated: null,
      stale: false,
      stale_reason: 'No data yet',
      error_message: null,
    };
  }

  const snapshotTime = new Date(probe.lastUpdated);
  const ageMs = now.getTime() - snapshotTime.getTime();
  const marketOpen = isChicagoMarketOpen(now);
  const expectedDate = expectedFuturesSessionDate(now);
  const snapshotDate = chicagoParts(snapshotTime).isoDate;

  let staleReason: string | null = null;

  if (snapshotDate < expectedDate) {
    staleReason = `Last futures snapshot is from ${formatDateShort(snapshotDate)}`;
  } else if (marketOpen && ageMs > FUTURES_INTRADAY_STALE_MS) {
    staleReason = `Last update was ${Math.round(ageMs / 60000)} minutes ago`;
  }

  return {
    source,
    state: staleReason ? 'stale' : 'fresh',
    last_updated: probe.lastUpdated,
    stale: Boolean(staleReason),
    stale_reason: staleReason,
    error_message: null,
  };
}

export function buildMarketDirectionSignal(params: {
  futures: FuturesSnapshotRow | null;
  futuresHealth?: DataHealthStatus;
  negotiatedRows: NegotiatedSalesRow[];
  coldStorage: ColdStorageMonthlyRow | null;
}): MarketDirectionSignal | null {
  const drivers: MarketDriverSignal[] = [];

  if (params.futures) {
    const rawScore = clamp(params.futures.change_pct / 1.2, -1, 1);
    const adjustedScore = params.futuresHealth?.stale ? rawScore * 0.6 : rawScore;
    drivers.push({
      key: 'futures',
      label: 'Futures',
      tone: toneFromScore(adjustedScore, 0.15),
      score: adjustedScore,
      weight: 0.45,
      detail: `${formatContractName(params.futures.front_month_contract)} ${formatSignedPct(
        params.futures.change_pct,
        2
      )} today${params.futuresHealth?.stale ? ' (stale feed)' : ''}`,
    });
  }

  const { latest, previous } = latestNegotiatedPair(params.negotiatedRows);
  if (latest) {
    const delta = previous ? latest.weighted_avg - previous.weighted_avg : 0;
    const qualityFactor = latest.session_quality === 'thin' ? 0.75 : 1;
    const score = clamp((delta / 4) * qualityFactor, -1, 1);
    drivers.push({
      key: 'negotiated',
      label: 'Negotiated',
      tone: toneFromScore(score, 0.18),
      score,
      weight: 0.35,
      detail: previous
        ? `${latest.session} ${formatSignedCurrency(delta)} vs prior ${previous.session} ${formatDateShort(
            previous.date
          )}`
        : `${latest.session} ${formatCurrency(latest.weighted_avg)} latest cash`,
    });
  }

  if (params.coldStorage) {
    const score = clamp((-params.coldStorage.vs_5yr_avg_pct) / 10, -1, 1);
    drivers.push({
      key: 'cold_storage',
      label: 'Cold Storage',
      tone: toneFromScore(score, 0.15),
      score,
      weight: 0.2,
      detail: `${formatSignedPct(params.coldStorage.vs_5yr_avg_pct, 1)} vs 5-year avg`,
    });
  }

  if (drivers.length === 0) return null;

  const totalWeight = drivers.reduce((sum, driver) => sum + driver.weight, 0);
  const weightedScore =
    totalWeight > 0
      ? drivers.reduce((sum, driver) => sum + driver.score * driver.weight, 0) /
        totalWeight
      : 0;
  const tone = toneFromScore(weightedScore, 0.2);

  const aligned = drivers.filter(
    (driver) => driver.tone === tone && driver.tone !== 'neutral'
  ).length;
  const stalePenalty = params.futuresHealth?.stale ? 8 : 0;
  const confidencePct = clamp(
    Math.round(54 + Math.abs(weightedScore) * 28 + aligned * 6 - stalePenalty),
    48,
    92
  );
  const confidenceLabel =
    confidencePct >= 80 ? 'high' : confidencePct >= 64 ? 'medium' : 'low';

  const alignedLabels = drivers
    .filter((driver) => driver.tone === tone && tone !== 'neutral')
    .map((driver) => driver.label.toLowerCase());

  const summary =
    tone === 'neutral'
      ? 'Signals are mixed across futures, negotiated cash, and cold storage.'
      : alignedLabels.length > 0
        ? `${alignedLabels.join(' and ')} are driving a ${tone} lean.`
        : `${toneLabel(tone)} tone, but with mixed supporting drivers.`;

  return {
    tone,
    confidence_pct: confidencePct,
    confidence_label: confidenceLabel,
    score: Number(weightedScore.toFixed(3)),
    summary,
    drivers,
  };
}

export function buildBidRangeCalculatorContext(params: {
  negotiatedRows: NegotiatedSalesRow[];
  cutoutChoice: number | null;
  marketSignal: MarketDirectionSignal | null;
}): BidRangeCalculatorContext {
  const { latest } = latestNegotiatedPair(params.negotiatedRows);
  const negotiatedAnchor = latest?.weighted_avg ?? null;
  const spreadToCutout =
    negotiatedAnchor != null && params.cutoutChoice != null
      ? params.cutoutChoice - negotiatedAnchor
      : null;
  const spreadLift =
    spreadToCutout == null ? 0 : clamp(spreadToCutout * 0.08, -5, 5);
  const toneLift =
    params.marketSignal?.tone === 'bull'
      ? 0.75
      : params.marketSignal?.tone === 'bear'
        ? -0.75
        : 0;
  const benchmarkPrice =
    negotiatedAnchor == null
      ? null
      : Number((negotiatedAnchor + spreadLift + toneLift).toFixed(2));

  return {
    benchmark_price: benchmarkPrice,
    negotiated_anchor: negotiatedAnchor,
    cutout_anchor: params.cutoutChoice,
    spread_to_cutout: spreadToCutout,
    latest_session: latest?.session ?? null,
    latest_session_quality: latest?.session_quality ?? null,
    market_tone: params.marketSignal?.tone ?? 'neutral',
    market_confidence_label: params.marketSignal?.confidence_label ?? 'low',
  };
}

function weightAdjustment(weightLbs: number): number {
  if (weightLbs < 1350) {
    return -clamp(((1350 - weightLbs) / 50) * 0.75, 0, 4);
  }

  if (weightLbs <= 1500) return 0.75;

  return -clamp(((weightLbs - 1500) / 25) * 0.5, 0, 6);
}

export function calculateBidRange(
  context: BidRangeCalculatorContext,
  input: BidRangeInput
): BidRangeOutput {
  const benchmark = context.benchmark_price ?? 0;

  const adjustments = [
    { label: 'Grade', amount: GRADE_ADJUSTMENTS[input.grade] },
    { label: 'Brand', amount: BRAND_ADJUSTMENTS[input.brand] },
    { label: 'Channel', amount: CHANNEL_ADJUSTMENTS[input.channel] },
    {
      label: `Weight (${Math.round(input.weight_lbs)} lb)`,
      amount: weightAdjustment(input.weight_lbs),
    },
  ];

  const midpoint =
    benchmark +
    adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const halfWidth =
    2.5 +
    (context.latest_session_quality === 'thin' ? 1 : 0) +
    (context.market_confidence_label === 'low'
      ? 0.75
      : context.market_confidence_label === 'medium'
        ? 0.25
        : 0);

  return {
    benchmark: Number(benchmark.toFixed(2)),
    midpoint: Number(midpoint.toFixed(2)),
    low: Number((midpoint - halfWidth).toFixed(2)),
    high: Number((midpoint + halfWidth).toFixed(2)),
    adjustments,
  };
}
