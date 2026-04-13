// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog } from '../_shared/log.ts';

const AGRIBEEF_URL = 'https://www.agribeef.com/market-quotes/';
const SOURCE = 'usda_futures_agribeef';

// Market hours check: 8:30 AM – 1:05 PM CT (UTC-6 CST conservative)
function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;

  const ctHour = now.getUTCHours() - 6;
  const ctMinute = now.getUTCMinutes();
  const ctTime = ctHour * 60 + ctMinute;
  const open = 8 * 60 + 30;  // 8:30
  const close = 13 * 60 + 5; // 13:05
  return ctTime >= open && ctTime <= close;
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const forceRun = url.searchParams.get('force') === 'true';

  if (!forceRun && !isMarketHours()) {
    return new Response(JSON.stringify({ status: 'skipped', reason: 'outside market hours' }), { status: 200 });
  }

  const supabase = getServiceClient();

  try {
    const YAHOO_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/LE=F?interval=1d&range=1d';

    const res = await fetch(YAHOO_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const json = await res.json();
    const meta = json.chart.result[0].meta;

    const snapshot = {
      timestamp: new Date().toISOString(),
      front_month_contract: meta.symbol ?? 'LE=F',
      front_month_price: meta.regularMarketPrice,
      change_today: meta.regularMarketPrice - meta.previousClose,
      change_pct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
      source: 'yahoo_finance',
    };

    const { error } = await supabase.from('futures_snapshots').insert(snapshot);
    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: null, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', snapshot }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: null, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
