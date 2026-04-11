# Highline

Beef pricing intelligence platform for AB Foods / Agri Beef. Ingests USDA AMS reports and live cattle futures into Supabase, exposes typed data queries to a Next.js dashboard.

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Supabase** — PostgreSQL + Edge Functions + pg_cron
- **Firecrawl** — USDA PDF scraping
- **Playwright** — live cattle futures scraping (agribeef.com)

## Setup

```bash
npm install
cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#          SUPABASE_SERVICE_ROLE_KEY, FIRECRAWL_API_KEY
```

## Development

```bash
npm run dev        # Next.js dev server → http://localhost:3000
npm test           # Run all tests (Vitest)
npm run test:watch # Watch mode
```

## Database

Apply migrations to your Supabase project:

```bash
supabase db push
# or manually run supabase/migrations/ in order
```

Tables: `cutout_daily`, `negotiated_sales`, `slaughter_weekly`, `cold_storage_monthly`, `futures_snapshots`, `ingestion_log`

## Edge Functions

Deploy to Supabase:

```bash
supabase functions deploy ingest-negotiated
supabase functions deploy ingest-slaughter
supabase functions deploy ingest-cold-storage
supabase functions deploy ingest-cutout
supabase functions deploy ingest-futures
```

Set required secrets:

```bash
supabase secrets set FIRECRAWL_API_KEY=fc-...
```

Enable pg_cron schedules by applying the third migration and setting:

```sql
ALTER DATABASE postgres SET app.supabase_url = 'https://your-project.supabase.co';
ALTER DATABASE postgres SET app.service_role_key = 'your-service-role-key';
```

## Data Access

```typescript
import {
  getLatestCutout,
  getCutoutHistory,
  getTodayNegotiated,
  getLatestFutures,
  getDataHealth,
} from '@/lib/supabase/queries';
```

## Project Structure

```
lib/
  types/index.ts        — all domain types
  utils/hash.ts         — SHA-256 for dedup
  parsers/              — USDA + futures scrapers
  supabase/
    client.ts           — Supabase client helpers
    queries.ts          — typed read queries
supabase/
  migrations/           — schema, RLS, pg_cron schedules
  functions/            — Deno Edge Functions (one per data source)
tests/                  — Vitest unit tests (21 tests)
```
