// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2453.pdf';
const SOURCE = 'usda_negotiated';
const THIN_THRESHOLD = 10;

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  const now = new Date().toISOString();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: REPORT_URL, formats: ['markdown'] }),
    });
    if (!fcRes.ok) throw new Error(`Firecrawl error: ${fcRes.status}`);
    const fcData = await fcRes.json();
    const markdown: string = fcData?.data?.markdown ?? '';
    if (!markdown.trim()) throw new Error('Empty markdown from Firecrawl');

    sourceHash = await sha256Deno(markdown);

    const { data: existing } = await supabase
      .from('negotiated_sales')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const sessionMatch = markdown.match(/Session[:\s]+(AM|PM)/i);
    const session = sessionMatch ? sessionMatch[1].toUpperCase() as 'AM' | 'PM' : 'AM';

    const dateMatch = markdown.match(/(\w+ \d{1,2},?\s*\d{4})/);
    const date = dateMatch ? new Date(dateMatch[1]).toISOString().split('T')[0] : now.split('T')[0];

    const extractNum = (label: string) => {
      const m = markdown.match(new RegExp(`${label}[:\\s]+([\\d,.]+)`, 'i'));
      return m ? parseFloat(m[1].replace(/,/g, '')) : null;
    };

    const low = extractNum('Low Price');
    const high = extractNum('High Price');
    const weighted_avg = extractNum('Weighted Average');
    const volume_loads = extractNum('Volume');

    if (weighted_avg === null || weighted_avg < 150 || weighted_avg > 400) {
      throw new Error(`weighted_avg ${weighted_avg} outside valid range [$150–$400/cwt]`);
    }
    if (volume_loads === null || volume_loads < 0 || volume_loads > 500) {
      throw new Error(`volume_loads ${volume_loads} outside valid range [0–500]`);
    }

    const { error } = await supabase.from('negotiated_sales').insert({
      date,
      session,
      low,
      high,
      weighted_avg,
      volume_loads,
      session_quality: volume_loads < THIN_THRESHOLD ? 'thin' : 'active',
      source_hash: sourceHash,
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({
      source: SOURCE,
      source_hash: sourceHash,
      status: 'failed',
      error_message: err.message,
      records_inserted: 0,
    });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
