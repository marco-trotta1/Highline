// @ts-nocheck
import { getServiceClient } from './supabase-client.ts';

export interface LogParams {
  source: string;
  source_hash: string | null;
  status: 'success' | 'failed' | 'duplicate';
  error_message?: string | null;
  records_inserted?: number;
}

export async function writeIngestionLog(params: LogParams): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.from('ingestion_log').insert({
    source: params.source,
    timestamp: new Date().toISOString(),
    source_hash: params.source_hash ?? null,
    status: params.status,
    error_message: params.error_message ?? null,
    records_inserted: params.records_inserted ?? 0,
  });
  if (error) {
    // Log failure is non-fatal — console.error and continue
    console.error('[ingestion_log] write failed:', error.message);
  }
}

// SHA-256 using Web Crypto (works in Deno Edge Functions)
export async function sha256Deno(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
