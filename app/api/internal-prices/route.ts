import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getPerformanceData } from '@/lib/supabase/queries';
import type {
  InternalPriceChannel,
  InternalPriceGrade,
  PerformancePrimal,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

const PRIMALS = new Set<PerformancePrimal>([
  'chuck',
  'rib',
  'loin',
  'round',
  'brisket',
  'short_plate',
  'flank',
]);
const GRADES = new Set<InternalPriceGrade>(['Choice', 'Select', 'Prime']);
const CHANNELS = new Set<InternalPriceChannel>(['fresh', 'frozen']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type InternalPriceInsert = {
  date: string;
  primal: PerformancePrimal;
  brand: string;
  grade: InternalPriceGrade;
  channel: InternalPriceChannel;
  price_cwt: number;
  notes?: string | null;
};

function validatePayload(body: unknown): InternalPriceInsert | string {
  if (!body || typeof body !== 'object') return 'Invalid JSON payload';
  const record = body as Record<string, unknown>;
  const date = typeof record.date === 'string' ? record.date : '';
  const primal = typeof record.primal === 'string' ? record.primal : '';
  const brand = typeof record.brand === 'string' && record.brand.trim() ? record.brand.trim() : 'AB';
  const grade = typeof record.grade === 'string' ? record.grade : '';
  const channel = typeof record.channel === 'string' ? record.channel : '';
  const priceValue = record.price_cwt ?? record.price;
  const price_cwt = Number(priceValue);
  const notes = typeof record.notes === 'string' && record.notes.trim()
    ? record.notes.trim()
    : null;

  if (!ISO_DATE_RE.test(date)) return 'date is required in YYYY-MM-DD format';
  if (!PRIMALS.has(primal as PerformancePrimal)) return 'primal is required';
  if (!GRADES.has(grade as InternalPriceGrade)) return 'grade is required';
  if (!CHANNELS.has(channel as InternalPriceChannel)) return 'channel is required';
  if (!Number.isFinite(price_cwt) || price_cwt <= 0) {
    return 'price_cwt must be a positive number';
  }

  return {
    date,
    primal: primal as PerformancePrimal,
    brand,
    grade: grade as InternalPriceGrade,
    channel: channel as InternalPriceChannel,
    price_cwt,
    notes,
  };
}

export async function GET() {
  try {
    const data = await getPerformanceData();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('/api/internal-prices GET failed', err);
    return NextResponse.json(
      { error: 'internal_prices_fetch_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const payload = validatePayload(body);
  if (typeof payload === 'string') {
    return NextResponse.json({ error: payload }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('internal_prices')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      return NextResponse.json(
        { error: error.code === '23505' ? 'duplicate_internal_price' : 'insert_failed' },
        { status }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('/api/internal-prices POST failed', err);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }
}
