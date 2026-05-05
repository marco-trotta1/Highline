import { TopNav } from '@/components/nav/TopNav';
import { PerformanceTracker } from '@/components/performance/PerformanceTracker';
import { getPerformanceData, getPerformanceSummary } from '@/lib/supabase/queries';

export const dynamic = 'force-dynamic';

export default async function PerformancePage() {
  const performanceData = await getPerformanceData();
  const summary = await getPerformanceSummary(performanceData);

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <PerformanceTracker
          initialData={performanceData}
          initialSummary={summary}
        />
      </main>
    </>
  );
}
