// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { writeIngestionLog } from './log.ts';

export async function checkSourceHashDuplicate(
  supabase: any,
  table: string,
  source: string,
  sourceHash: string
): Promise<Response | null> {
  const { data: existing } = await supabase
    .from(table)
    .select('id')
    .eq('source_hash', sourceHash)
    .single();

  if (!existing) return null;

  await writeIngestionLog({
    source,
    source_hash: sourceHash,
    status: 'duplicate',
    records_inserted: 0,
  });
  return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
}

export async function respondIngestSuccess(
  source: string,
  sourceHash: string,
  recordsInserted = 1
): Promise<Response> {
  await writeIngestionLog({
    source,
    source_hash: sourceHash,
    status: 'success',
    records_inserted: recordsInserted,
  });
  return new Response(
    JSON.stringify({ status: 'success', records_inserted: recordsInserted }),
    { status: 200 }
  );
}

export async function respondIngestFailure(
  source: string,
  sourceHash: string | null,
  err: any
): Promise<Response> {
  await writeIngestionLog({
    source,
    source_hash: sourceHash,
    status: 'failed',
    error_message: err.message,
    records_inserted: 0,
  });
  return new Response(
    JSON.stringify({ status: 'failed', error: err.message }),
    { status: 500 }
  );
}
