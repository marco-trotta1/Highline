import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const INGESTION_SOURCES = [
  'cutout',
  'usda_cutout',
  'negotiated',
  'usda_negotiated',
  'slaughter',
  'usda_slaughter',
  'futures',
  'usda_futures_agribeef',
] as const;

type IngestionHealthRow = {
  source: string;
  timestamp: string;
  status: 'success' | 'failed' | 'duplicate';
};

export async function GET() {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('ingestion_log')
      .select('source,timestamp,status')
      .in('source', INGESTION_SOURCES)
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) {
      console.error('/api/ingestion-health Supabase query failed', error);
      return NextResponse.json(
        { error: 'ingestion_health_failed' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json((data ?? []) as IngestionHealthRow[], {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('/api/ingestion-health failed', err);
    return NextResponse.json(
      { error: 'ingestion_health_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
