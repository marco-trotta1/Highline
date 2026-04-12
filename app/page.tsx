import { Dashboard } from '@/components/dashboard/Dashboard';
import { getSnapshot } from '@/lib/supabase/queries';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const snapshot = await getSnapshot();
  return <Dashboard initialData={snapshot} />;
}
