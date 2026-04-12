import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/supabase/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await getSnapshot();
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('/api/snapshot failed', err);
    return NextResponse.json(
      { error: 'snapshot_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
