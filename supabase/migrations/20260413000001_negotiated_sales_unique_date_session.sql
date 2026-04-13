BEGIN;

-- Clean placeholder/broken rows so the new unique index can be created.
DELETE FROM public.negotiated_sales
 WHERE source_hash LIKE 'seed-%'
    OR source_hash LIKE '%-AM'
    OR source_hash LIKE '%-PM';

ALTER TABLE public.negotiated_sales
  DROP CONSTRAINT IF EXISTS negotiated_sales_source_hash_key;

ALTER TABLE public.negotiated_sales
  ADD CONSTRAINT negotiated_sales_date_session_key UNIQUE (date, session);

COMMIT;
