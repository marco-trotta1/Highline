// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_3208.pdf';
const SOURCE = 'usda_slaughter';

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
      .from('slaughter_weekly')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const weekMatch = markdown.match(/Week Ending[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
    const week_ending = weekMatch
      ? new Date(weekMatch[1]).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const extractHead = (label: string) => {
      const m = markdown.match(new RegExp(`${label}[:\\s]+([\\d,]+)`, 'i'));
      return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
    };

    const total_head = extractHead('Total Head Slaughtered');
    const steer_count = extractHead('Steers');
    const heifer_count = extractHead('Heifers');

    if (total_head === null || total_head < 400_000 || total_head > 700_000) {
      throw new Error(`total_head ${total_head} outside valid range [400k–700k]`);
    }

    const total = (steer_count ?? 0) + (heifer_count ?? 0);
    const steer_heifer_ratio = total > 0 ? (steer_count ?? 0) / total : 0;

    if (steer_heifer_ratio < 0.3 || steer_heifer_ratio > 0.7) {
      throw new Error(`steer_heifer_ratio ${steer_heifer_ratio.toFixed(4)} outside valid range [0.3–0.7]`);
    }

    const { error } = await supabase.from('slaughter_weekly').insert({
      week_ending,
      total_head,
      steer_count,
      heifer_count,
      steer_heifer_ratio,
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
