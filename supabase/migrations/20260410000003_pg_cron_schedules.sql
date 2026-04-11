-- Requires pg_cron extension (enabled by default on Supabase Pro)
-- All times in UTC. CT = UTC-6 (CST) or UTC-5 (CDT); using UTC-6 conservative.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Negotiated sales AM: 11:00 AM CT = 17:00 UTC, Mon–Fri
SELECT cron.schedule(
  'ingest-negotiated-am',
  '0 17 * * 1-5',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-negotiated',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Negotiated sales PM: 3:30 PM CT = 21:30 UTC, Mon–Fri
SELECT cron.schedule(
  'ingest-negotiated-pm',
  '30 21 * * 1-5',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-negotiated',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Cutout AM: 11:00 AM CT = 17:00 UTC, Mon–Fri
SELECT cron.schedule(
  'ingest-cutout-am',
  '0 17 * * 1-5',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-cutout',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Cutout PM: 3:30 PM CT = 21:30 UTC, Mon–Fri
SELECT cron.schedule(
  'ingest-cutout-pm',
  '30 21 * * 1-5',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-cutout',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Slaughter: Monday 6:00 AM CT = 12:00 UTC
SELECT cron.schedule(
  'ingest-slaughter-weekly',
  '0 12 * * 1',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-slaughter',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Cold storage: 1st of month 6:00 AM CT = 12:00 UTC
SELECT cron.schedule(
  'ingest-cold-storage-monthly',
  '0 12 1 * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-cold-storage',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Futures: every 30 minutes Mon–Fri (function itself guards market hours 8:30–13:05 CT)
SELECT cron.schedule(
  'ingest-futures-30min',
  '*/30 * * * 1-5',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-futures',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Note: current_setting('app.supabase_url') and current_setting('app.service_role_key')
-- must be set via Supabase dashboard or:
-- ALTER DATABASE postgres SET app.supabase_url = 'https://your-project.supabase.co';
-- ALTER DATABASE postgres SET app.service_role_key = 'your-service-role-key';
