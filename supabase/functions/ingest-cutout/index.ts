// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2466.pdf';
const SOURCE = 'usda_cutout';

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

    const { data: existing } = await supabase
      .from('cutout_daily')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const extractPrice = (label: string) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = markdown.match(new RegExp(`${escaped}[:\\s]+([\\d.]+)`, 'i'));
      return m ? parseFloat(m[1]) : null;
    };

    const reportTypeMatch = markdown.match(/^(LM_\w+)/m);
    const report_type = reportTypeMatch ? reportTypeMatch[1] : 'Unknown';

    const dateMatch = markdown.match(/Report Date[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
    const date = dateMatch
      ? new Date(dateMatch[1]).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const choice_total = extractPrice('Choice Total');
    const select_total = extractPrice('Select Total');
    const chuck = extractPrice('Chuck');
    const rib = extractPrice('Rib');
    const loin = extractPrice('Loin');
    const round = extractPrice('Round');
    const brisket = extractPrice('Brisket');
    const short_plate = extractPrice('Short Plate');
    const flank = extractPrice('Flank');

    const fields: Record<string, number | null> = {
      choice_total, select_total, chuck, rib, loin, round, brisket, short_plate, flank,
    };
    const missing = Object.entries(fields)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    if (missing.length > 0) {
      throw new Error(`Could not extract cutout fields: ${missing.join(', ')}`);
    }

    const { error } = await supabase.from('cutout_daily').insert({
      date,
      report_type,
      choice_total,
      select_total,
      choice_select_spread: (choice_total ?? 0) - (select_total ?? 0),
      chuck,
      rib,
      loin,
      round,
      brisket,
      short_plate,
      flank,
      source_hash: sourceHash,
      updated_at: new Date().toISOString(),
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
