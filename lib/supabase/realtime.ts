'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBrowserClient } from './client';

export type RealtimeTable =
  | 'cutout_daily'
  | 'negotiated_sales'
  | 'futures_snapshots';

type InsertHandler = (table: RealtimeTable, row: unknown) => void;
type StatusHandler = (status: 'connected' | 'disconnected') => void;

export function subscribeToSnapshot(
  onInsert: InsertHandler,
  onStatus: StatusHandler
): () => void {
  const sb = createBrowserClient();
  const channel: RealtimeChannel = sb
    .channel('snapshot')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cutout_daily' },
      (payload) => onInsert('cutout_daily', payload.new)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'negotiated_sales' },
      (payload) => onInsert('negotiated_sales', payload.new)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'futures_snapshots' },
      (payload) => onInsert('futures_snapshots', payload.new)
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onStatus('connected');
      } else if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        onStatus('disconnected');
      }
    });

  return () => {
    void sb.removeChannel(channel);
  };
}
