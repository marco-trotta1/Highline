// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.nass.usda.gov/Publications/Todays_Reports/reports/cofd0426.pdf';
const SOURCE = 'usda_cold_storage';

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: REPORT_URL, formats: ['markdown'] }),
    });
    if (!fcRes.ok) throw new Error(`Firecrawl error: ${fcRes.status}`);
    const fcData = await fcRes.json();
    const markdown: string = fcData?.data?.markdown ?? '';
    if (!markdown.trim()) throw new Error('Empty markdown from Firecrawl');

    sourceHash = await sha256Deno(markdown);

    const beefMatch = markdown.match(/Total Beef[^:]*:\s*([\d,]+\.?\d*)\s*million/i);
    const total_beef_million_lbs = beefMatch ? parseFloat(beefMatch[1].replace(/,/g, '')) : null;
    if (total_beef_million_lbs === null) throw new Error('Could not extract total beef lbs');

    const monthYearMatch = markdown.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
    if (!monthYearMatch) throw new Error('Could not extract month/year');
    const month = MONTH_NAMES[monthYearMatch[1].toLowerCase()];
    const year = parseInt(monthYearMatch[2], 10);

    const { data: existing } = await supabase
      .from('cold_storage_monthly')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const { data: historical } = await supabase
      .from('cold_storage_monthly')
      .select('total_beef_million_lbs')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(60);

    let vs_5yr_avg_pct = 0;
    if (historical && historical.length > 0) {
      const avg = historical.reduce((s: number, r: { total_beef_million_lbs: number }) => s + r.total_beef_million_lbs, 0) / historical.length;
      vs_5yr_avg_pct = avg > 0 ? parseFloat((((total_beef_million_lbs - avg) / avg) * 100).toFixed(2)) : 0;
    }

    const { error } = await supabase.from('cold_storage_monthly').insert({
      month,
      year,
      total_beef_million_lbs,
      vs_5yr_avg_pct,
      source_hash: sourceHash,
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
