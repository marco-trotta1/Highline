import { renderToBuffer } from '@react-pdf/renderer';
import path from 'node:path';
import { TradeSheetDocument } from '@/lib/pdf/TradeSheetDocument';
import {
  getLatestCutout,
  getLatestFutures,
  getLatestSignalSnapshot,
  getSubprimalPricesLatestDate,
} from '@/lib/supabase/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function filenameDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function GET() {
  try {
    const generatedAt = new Date();
    const [rows, cutout, futures, signal] = await Promise.all([
      getSubprimalPricesLatestDate(),
      getLatestCutout(),
      getLatestFutures(),
      getLatestSignalSnapshot(),
    ]);

    const logoSrc = path.join(process.cwd(), 'public', 'ab-logo-white.png');
    const document = TradeSheetDocument({
      rows,
      cutout,
      futures,
      signal,
      generatedAt,
      logoSrc,
    }) as Parameters<typeof renderToBuffer>[0];
    const pdf = await renderToBuffer(document);
    const date = filenameDate(generatedAt);

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="highline-trade-sheet-${date}.pdf"`,
      },
    });
  } catch (err) {
    console.error('/api/trade-sheet/pdf failed', err);
    return Response.json(
      { error: 'trade_sheet_pdf_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
