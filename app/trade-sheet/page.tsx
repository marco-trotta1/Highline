import { getSubprimalPricesLatestDate } from '@/lib/supabase/queries';
import { TopNav } from '@/components/nav/TopNav';
import { TradeSheetClient } from '@/components/trade-sheet/TradeSheetClient';

export const dynamic = 'force-dynamic';

export default async function TradeSheetPage() {
  const rows = await getSubprimalPricesLatestDate();
  const latestDate = rows.length > 0 ? rows[0].date : null;
  const today = new Date().toISOString().split('T')[0];
  const isStale = latestDate !== null && latestDate !== today;

  return (
    <>
      <TopNav />
      <main className="flex-1 px-4 py-6 sm:px-6">
        <TradeSheetClient rows={rows} latestDate={latestDate} isStale={isStale} />
      </main>
    </>
  );
}
