# Highline Data Ingestion Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully-typed data ingestion pipeline that scrapes USDA PDF reports and live cattle futures, stores structured records in Supabase, and exposes a typed data access layer for the Next.js frontend.

**Architecture:** Five Supabase Edge Functions pull from four USDA PDF parsers (Firecrawl) and one Playwright scraper (live futures); all inserts are idempotent via SHA-256 content hashes; every invocation writes to `ingestion_log` regardless of outcome. The `lib/` directory is shared TypeScript used by both Edge Functions and the Next.js app.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (PostgreSQL + Edge Functions + pg_cron), Firecrawl JS SDK, Playwright, Vitest.

---

## File Map

```
highline/
├── supabase/
│   ├── migrations/
│   │   ├── 20260410000001_create_tables.sql
│   │   └── 20260410000002_rls_policies.sql
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── supabase-client.ts   # service-role Supabase client for Deno
│   │   │   └── log.ts               # writeIngestionLog helper
│   │   ├── ingest-negotiated/index.ts
│   │   ├── ingest-slaughter/index.ts
│   │   ├── ingest-cold-storage/index.ts
│   │   ├── ingest-cutout/index.ts
│   │   └── ingest-futures/index.ts
│   └── config.toml
├── lib/
│   ├── types/index.ts               # all domain types
│   ├── utils/hash.ts                # sha256 helper (Node crypto)
│   ├── parsers/
│   │   ├── usda-negotiated.ts
│   │   ├── usda-slaughter.ts
│   │   ├── usda-cold-storage.ts
│   │   ├── usda-cutout.ts
│   │   └── futures-scraper.ts
│   └── supabase/
│       ├── client.ts                # anon client for Next.js app
│       └── queries.ts               # all read queries
├── tests/
│   ├── parsers/
│   │   ├── usda-negotiated.test.ts
│   │   ├── usda-slaughter.test.ts
│   │   ├── usda-cold-storage.test.ts
│   │   ├── usda-cutout.test.ts
│   │   └── futures-scraper.test.ts
│   └── queries/
│       └── queries.test.ts
├── .env.local.example
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `.env.local.example`
- Create: `.gitignore`

- [ ] **Step 1: Scaffold Next.js 15 app**

```bash
cd "/Users/marcotrotta/Desktop/Highline Code"
npx create-next-app@latest . \
  --typescript \
  --app \
  --no-src-dir \
  --tailwind \
  --eslint \
  --no-import-alias \
  --yes
```

Expected: Next.js 15 app created with App Router.

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install \
  @supabase/supabase-js \
  @mendable/firecrawl-js \
  @playwright/test \
  playwright
```

- [ ] **Step 3: Install dev/test dependencies**

```bash
npm install --save-dev \
  vitest \
  @vitest/coverage-v8 \
  vite-tsconfig-paths
```

- [ ] **Step 4: Update package.json test scripts**

Open `package.json` and add to the `"scripts"` section:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 5: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 6: Create .env.local.example**

```bash
cat > .env.local.example << 'EOF'
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Firecrawl
FIRECRAWL_API_KEY=fc-your-key-here

# Playwright (for futures scraper)
PLAYWRIGHT_HEADLESS=true
EOF
```

- [ ] **Step 7: Create directories**

```bash
mkdir -p lib/types lib/utils lib/parsers lib/supabase
mkdir -p supabase/migrations supabase/functions/_shared
mkdir -p supabase/functions/ingest-negotiated
mkdir -p supabase/functions/ingest-slaughter
mkdir -p supabase/functions/ingest-cold-storage
mkdir -p supabase/functions/ingest-cutout
mkdir -p supabase/functions/ingest-futures
mkdir -p tests/parsers tests/queries
mkdir -p docs/superpowers/plans
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 app with dependencies"
```

---

## Task 2: Domain Types

**Files:**
- Create: `lib/types/index.ts`

- [ ] **Step 1: Write the types file**

```typescript
// lib/types/index.ts

export interface NegotiatedSalesRecord {
  date: string; // ISO 8601 date, e.g. "2026-04-10"
  session: 'AM' | 'PM';
  low: number;
  high: number;
  weighted_avg: number;
  volume_loads: number;
  session_quality: 'active' | 'thin';
  source_hash: string;
}

export interface SlaughterRecord {
  week_ending: string; // ISO 8601 date
  total_head: number;
  steer_count: number;
  heifer_count: number;
  steer_heifer_ratio: number; // steer_count / (steer_count + heifer_count)
  source_hash: string;
}

export interface ColdStorageRecord {
  month: number; // 1–12
  year: number;
  total_beef_million_lbs: number;
  vs_5yr_avg_pct: number;
  source_hash: string;
}

export interface CutoutRecord {
  date: string; // ISO 8601 date
  report_type: string; // e.g. "LM_XB459", "Daily"
  choice_total: number;
  select_total: number;
  choice_select_spread: number; // choice_total - select_total
  chuck: number;
  rib: number;
  loin: number;
  round: number;
  brisket: number;
  short_plate: number;
  flank: number;
  source_hash: string;
}

export interface FuturesSnapshot {
  timestamp: string; // ISO 8601 datetime
  front_month_contract: string; // e.g. "LCM26"
  front_month_price: number;
  change_today: number;
  change_pct: number;
  source: string; // default: 'agribeef_scrape'
}

export interface IngestionLogEntry {
  source: string;
  timestamp: string; // ISO 8601 datetime
  source_hash: string | null;
  status: 'success' | 'failed' | 'duplicate';
  error_message: string | null;
  records_inserted: number;
}

export interface ValidationError {
  field: string;
  value: unknown;
  reason: string;
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: ValidationError[] = []
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

// Supabase row shapes (what comes back from the DB)
export interface CutoutDailyRow extends CutoutRecord {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface NegotiatedSalesRow extends NegotiatedSalesRecord {
  id: string;
  created_at: string;
}

export interface SlaughterWeeklyRow extends SlaughterRecord {
  id: string;
  created_at: string;
}

export interface ColdStorageMonthlyRow extends ColdStorageRecord {
  id: string;
  created_at: string;
}

export interface FuturesSnapshotRow extends FuturesSnapshot {
  id: string;
  created_at: string;
}

export interface DataHealthStatus {
  source: string;
  last_updated: string | null;
  stale: boolean;
  stale_reason: string | null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types/index.ts
git commit -m "feat: add domain types for all ingestion records"
```

---

## Task 3: SHA-256 Hash Utility

**Files:**
- Create: `lib/utils/hash.ts`
- Create: `tests/parsers/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/parsers/hash.test.ts
import { describe, it, expect } from 'vitest';
import { sha256 } from '../../lib/utils/hash';

describe('sha256', () => {
  it('produces a 64-char hex string', () => {
    const result = sha256('hello world');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
  });

  it('is sensitive to content changes', () => {
    expect(sha256('abc')).not.toBe(sha256('abcd'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/hash.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/utils/hash'`

- [ ] **Step 3: Implement hash utility**

```typescript
// lib/utils/hash.ts
import { createHash } from 'crypto';

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/parsers/hash.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/hash.ts tests/parsers/hash.test.ts
git commit -m "feat: add sha256 hash utility"
```

---

## Task 4: Supabase Migrations

**Files:**
- Create: `supabase/migrations/20260410000001_create_tables.sql`
- Create: `supabase/migrations/20260410000002_rls_policies.sql`
- Create: `supabase/config.toml`

- [ ] **Step 1: Write table creation migration**

```sql
-- supabase/migrations/20260410000001_create_tables.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Beef cutout (daily boxed beef values, all primals)
CREATE TABLE cutout_daily (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date                date NOT NULL,
  report_type         text NOT NULL,
  choice_total        numeric,
  select_total        numeric,
  choice_select_spread numeric,
  chuck               numeric,
  rib                 numeric,
  loin                numeric,
  round               numeric,
  brisket             numeric,
  short_plate         numeric,
  flank               numeric,
  source_hash         text UNIQUE NOT NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Negotiated cash sales (AM and PM sessions)
CREATE TABLE negotiated_sales (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date            date NOT NULL,
  session         text CHECK (session IN ('AM','PM')),
  low             numeric,
  high            numeric,
  weighted_avg    numeric,
  volume_loads    integer,
  session_quality text CHECK (session_quality IN ('active','thin')),
  source_hash     text UNIQUE NOT NULL,
  created_at      timestamptz DEFAULT now()
);

-- Weekly slaughter numbers
CREATE TABLE slaughter_weekly (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_ending         date NOT NULL,
  total_head          integer,
  steer_count         integer,
  heifer_count        integer,
  steer_heifer_ratio  numeric,
  source_hash         text UNIQUE NOT NULL,
  created_at          timestamptz DEFAULT now()
);

-- Monthly cold storage inventory
CREATE TABLE cold_storage_monthly (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  month                   integer CHECK (month BETWEEN 1 AND 12),
  year                    integer,
  total_beef_million_lbs  numeric,
  vs_5yr_avg_pct          numeric,
  source_hash             text UNIQUE NOT NULL,
  created_at              timestamptz DEFAULT now()
);

-- Live cattle futures snapshots
CREATE TABLE futures_snapshots (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp             timestamptz NOT NULL,
  front_month_contract  text,
  front_month_price     numeric,
  change_today          numeric,
  change_pct            numeric,
  source                text DEFAULT 'agribeef_scrape',
  created_at            timestamptz DEFAULT now()
);

-- Ingestion audit log
CREATE TABLE ingestion_log (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source           text NOT NULL,
  timestamp        timestamptz NOT NULL,
  source_hash      text,
  status           text CHECK (status IN ('success','failed','duplicate')),
  error_message    text,
  records_inserted integer DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX ON cutout_daily (date DESC);
CREATE INDEX ON negotiated_sales (date DESC, session);
CREATE INDEX ON slaughter_weekly (week_ending DESC);
CREATE INDEX ON cold_storage_monthly (year DESC, month DESC);
CREATE INDEX ON futures_snapshots (timestamp DESC);
CREATE INDEX ON ingestion_log (source, timestamp DESC);
```

- [ ] **Step 2: Write RLS policies migration**

```sql
-- supabase/migrations/20260410000002_rls_policies.sql

-- Enable RLS on all tables
ALTER TABLE cutout_daily          ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiated_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE slaughter_weekly      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_storage_monthly  ENABLE ROW LEVEL SECURITY;
ALTER TABLE futures_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_log         ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT from all tables
CREATE POLICY "auth_read_cutout_daily"
  ON cutout_daily FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_negotiated_sales"
  ON negotiated_sales FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_slaughter_weekly"
  ON slaughter_weekly FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_cold_storage_monthly"
  ON cold_storage_monthly FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_futures_snapshots"
  ON futures_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_ingestion_log"
  ON ingestion_log FOR SELECT TO authenticated USING (true);

-- NOTE: The service_role key bypasses RLS entirely in Supabase.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY, so no explicit
-- INSERT/UPDATE/DELETE policies are needed for them.
-- Anon users have no access (no anon policies defined).
```

- [ ] **Step 3: Create supabase/config.toml**

```toml
# supabase/config.toml
[project]
id = "highline"

[db]
port = 54322
shadow_port = 54320
major_version = 15

[api]
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[studio]
port = 54323

[inbucket]
port = 54324

[storage]
enabled = true
```

- [ ] **Step 4: Apply migrations locally (if Supabase CLI installed)**

```bash
# Only run if you have Supabase CLI installed
supabase db reset
```

If not installed, migrations will be applied when the project is linked. Skip to commit.

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add schema migrations and RLS policies"
```

---

## Task 5: Supabase Client (Node.js / Next.js)

**Files:**
- Create: `lib/supabase/client.ts`

- [ ] **Step 1: Write the client**

```typescript
// lib/supabase/client.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Anon client — used in Next.js server components and API routes.
// Respects RLS; authenticated users get SELECT access.
export function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }
  return createClient(url, key);
}

// Service-role client — used only in server-side code (queries.ts).
// Bypasses RLS. Never expose to the browser.
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/client.ts
git commit -m "feat: add Supabase client helpers"
```

---

## Task 6: Shared Edge Function Helpers (Deno)

**Files:**
- Create: `supabase/functions/_shared/supabase-client.ts`
- Create: `supabase/functions/_shared/log.ts`

These files run inside Supabase Edge Functions (Deno runtime). They use
`npm:` specifiers and Web Crypto API instead of Node's `crypto`.

- [ ] **Step 1: Write the Deno Supabase client**

```typescript
// supabase/functions/_shared/supabase-client.ts
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';

export function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 2: Write the ingestion log helper**

```typescript
// supabase/functions/_shared/log.ts
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
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat: add shared Edge Function helpers (Deno)"
```

---

## Task 7: USDA Negotiated Sales Parser

**Files:**
- Create: `lib/parsers/usda-negotiated.ts`
- Create: `tests/parsers/usda-negotiated.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/usda-negotiated.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firecrawl before importing the parser
vi.mock('@mendable/firecrawl-js', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      scrapeUrl: vi.fn(),
    })),
  };
});

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseNegotiatedSales } from '../../lib/parsers/usda-negotiated';

const MOCK_MARKDOWN = `
LM_CT113 - Negotiated Sales - Live Cattle
Report Date: April 10, 2026

Session: AM
Low Price: 188.00
High Price: 192.00
Weighted Average: 190.25
Volume: 15 Loads
`;

const THIN_MOCK_MARKDOWN = `
LM_CT113 - Negotiated Sales - Live Cattle
Report Date: April 10, 2026

Session: PM
Low Price: 189.00
High Price: 191.00
Weighted Average: 190.00
Volume: 8 Loads
`;

describe('parseNegotiatedSales', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ scrapeUrl: mockScrapeUrl })
    );
  });

  it('parses AM session from markdown', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseNegotiatedSales('test-api-key');
    expect(result.session).toBe('AM');
    expect(result.low).toBe(188.0);
    expect(result.high).toBe(192.0);
    expect(result.weighted_avg).toBe(190.25);
    expect(result.volume_loads).toBe(15);
    expect(result.session_quality).toBe('active');
    expect(result.source_hash).toHaveLength(64);
  });

  it('flags thin session when volume < 10 loads', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: THIN_MOCK_MARKDOWN, success: true });
    const result = await parseNegotiatedSales('test-api-key');
    expect(result.session_quality).toBe('thin');
    expect(result.volume_loads).toBe(8);
  });

  it('throws ParseError when weighted_avg is out of range', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('190.25', '50.00');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseNegotiatedSales('test-api-key')).rejects.toThrow('weighted_avg');
  });

  it('throws ParseError when volume is out of range', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('15 Loads', '600 Loads');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseNegotiatedSales('test-api-key')).rejects.toThrow('volume_loads');
  });

  it('throws when scrape returns no markdown', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: '', success: true });
    await expect(parseNegotiatedSales('test-api-key')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/usda-negotiated.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/parsers/usda-negotiated'`

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/usda-negotiated.ts
import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { NegotiatedSalesRecord, ValidationError } from '../types';
import { ParseError } from '../types';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2453.pdf';

// Validation bounds
const WEIGHTED_AVG_MIN = 150;
const WEIGHTED_AVG_MAX = 400;
const VOLUME_MIN = 0;
const VOLUME_MAX = 500;
const THIN_THRESHOLD = 10;

function extractNumber(text: string, label: string): number | null {
  // Matches "Label: 123.45" or "Label 123.45"
  const regex = new RegExp(`${label}[:\\s]+([\\d,]+\\.?\\d*)`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

function extractSession(text: string): 'AM' | 'PM' | null {
  const match = text.match(/Session[:\s]+(AM|PM)/i);
  if (!match) return null;
  return match[1].toUpperCase() as 'AM' | 'PM';
}

function extractDate(text: string): string | null {
  // Matches "April 10, 2026" or "04/10/2026"
  const longMatch = text.match(
    /(\w+ \d{1,2},?\s*\d{4})/
  );
  if (longMatch) {
    const parsed = new Date(longMatch[1]);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  const shortMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (shortMatch) {
    const [m, d, y] = shortMatch[1].split('/');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export async function parseNegotiatedSales(
  apiKey: string
): Promise<NegotiatedSalesRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await app.scrapeUrl(REPORT_URL, {
    formats: ['markdown'],
  });

  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for negotiated sales report');
  }

  const hash = sha256(markdown);
  const date = extractDate(markdown) ?? new Date().toISOString().split('T')[0];
  const session = extractSession(markdown);
  const low = extractNumber(markdown, 'Low Price');
  const high = extractNumber(markdown, 'High Price');
  const weighted_avg = extractNumber(markdown, 'Weighted Average');
  const volume_loads = extractNumber(markdown, 'Volume');

  // Validate
  const errors: ValidationError[] = [];

  if (session === null) {
    errors.push({ field: 'session', value: null, reason: 'Could not extract AM/PM session from report' });
  }
  if (weighted_avg === null || weighted_avg < WEIGHTED_AVG_MIN || weighted_avg > WEIGHTED_AVG_MAX) {
    errors.push({
      field: 'weighted_avg',
      value: weighted_avg,
      reason: `weighted_avg ${weighted_avg} is outside valid range [$${WEIGHTED_AVG_MIN}–$${WEIGHTED_AVG_MAX}/cwt]`,
    });
  }
  if (volume_loads === null || volume_loads < VOLUME_MIN || volume_loads > VOLUME_MAX) {
    errors.push({
      field: 'volume_loads',
      value: volume_loads,
      reason: `volume_loads ${volume_loads} is outside valid range [${VOLUME_MIN}–${VOLUME_MAX} loads]`,
    });
  }

  if (errors.length > 0) {
    throw new ParseError(
      errors.map((e) => e.reason).join('; '),
      errors
    );
  }

  return {
    date,
    session: session!,
    low: low ?? 0,
    high: high ?? 0,
    weighted_avg: weighted_avg!,
    volume_loads: volume_loads!,
    session_quality: volume_loads! < THIN_THRESHOLD ? 'thin' : 'active',
    source_hash: hash,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/parsers/usda-negotiated.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/usda-negotiated.ts tests/parsers/usda-negotiated.test.ts
git commit -m "feat: add USDA negotiated sales parser with validation"
```

---

## Task 8: USDA Slaughter Parser

**Files:**
- Create: `lib/parsers/usda-slaughter.ts`
- Create: `tests/parsers/usda-slaughter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/usda-slaughter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(() => ({ scrapeUrl: vi.fn() })),
}));

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseSlaughter } from '../../lib/parsers/usda-slaughter';

const MOCK_MARKDOWN = `
LM_CT150 - Weekly Cattle Slaughter
Week Ending: April 05, 2026

Total Head Slaughtered: 540,000
Steers: 310,000
Heifers: 200,000
`;

describe('parseSlaughter', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ scrapeUrl: mockScrapeUrl })
    );
  });

  it('parses slaughter data correctly', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseSlaughter('test-api-key');
    expect(result.total_head).toBe(540000);
    expect(result.steer_count).toBe(310000);
    expect(result.heifer_count).toBe(200000);
    expect(result.steer_heifer_ratio).toBeCloseTo(310000 / 510000, 5);
    expect(result.source_hash).toHaveLength(64);
  });

  it('throws when ratio is outside 0.3–0.7', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('Heifers: 200,000', 'Heifers: 20,000');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseSlaughter('test-api-key')).rejects.toThrow('steer_heifer_ratio');
  });

  it('throws when total_head is outside 400k–700k', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('540,000', '1,200,000');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseSlaughter('test-api-key')).rejects.toThrow('total_head');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/usda-slaughter.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/parsers/usda-slaughter'`

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/usda-slaughter.ts
import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { SlaughterRecord, ValidationError } from '../types';
import { ParseError } from '../types';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_3208.pdf';

const RATIO_MIN = 0.3;
const RATIO_MAX = 0.7;
const TOTAL_HEAD_MIN = 400_000;
const TOTAL_HEAD_MAX = 700_000;

function extractHeadCount(text: string, label: string): number | null {
  const regex = new RegExp(`${label}[:\\s]+([\\d,]+)`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ''), 10);
}

function extractWeekEnding(text: string): string {
  const match = text.match(/Week Ending[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
  if (match) {
    const parsed = new Date(match[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

export async function parseSlaughter(apiKey: string): Promise<SlaughterRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await app.scrapeUrl(REPORT_URL, { formats: ['markdown'] });
  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for slaughter report');
  }

  const hash = sha256(markdown);
  const week_ending = extractWeekEnding(markdown);
  const total_head = extractHeadCount(markdown, 'Total Head Slaughtered');
  const steer_count = extractHeadCount(markdown, 'Steers');
  const heifer_count = extractHeadCount(markdown, 'Heifers');

  const errors: ValidationError[] = [];

  if (total_head === null || total_head < TOTAL_HEAD_MIN || total_head > TOTAL_HEAD_MAX) {
    errors.push({
      field: 'total_head',
      value: total_head,
      reason: `total_head ${total_head} is outside valid range [${TOTAL_HEAD_MIN.toLocaleString()}–${TOTAL_HEAD_MAX.toLocaleString()}]`,
    });
  }

  if (steer_count !== null && heifer_count !== null) {
    const total = steer_count + heifer_count;
    if (total > 0) {
      const ratio = steer_count / total;
      if (ratio < RATIO_MIN || ratio > RATIO_MAX) {
        errors.push({
          field: 'steer_heifer_ratio',
          value: ratio,
          reason: `steer_heifer_ratio ${ratio.toFixed(4)} is outside valid range [${RATIO_MIN}–${RATIO_MAX}]`,
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new ParseError(errors.map((e) => e.reason).join('; '), errors);
  }

  const total = steer_count! + heifer_count!;

  return {
    week_ending,
    total_head: total_head!,
    steer_count: steer_count!,
    heifer_count: heifer_count!,
    steer_heifer_ratio: total > 0 ? steer_count! / total : 0,
    source_hash: hash,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/parsers/usda-slaughter.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/usda-slaughter.ts tests/parsers/usda-slaughter.test.ts
git commit -m "feat: add USDA slaughter parser with validation"
```

---

## Task 9: USDA Cold Storage Parser

**Files:**
- Create: `lib/parsers/usda-cold-storage.ts`
- Create: `tests/parsers/usda-cold-storage.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/usda-cold-storage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(() => ({ scrapeUrl: vi.fn() })),
}));

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseColdStorage } from '../../lib/parsers/usda-cold-storage';

const MOCK_SUPABASE_DATA = [
  { total_beef_million_lbs: 480.0 },
  { total_beef_million_lbs: 470.0 },
  { total_beef_million_lbs: 460.0 },
  { total_beef_million_lbs: 455.0 },
  { total_beef_million_lbs: 450.0 },
];

const MOCK_MARKDOWN = `
USDA Cold Storage Report
March 2026

Total Beef in Cold Storage: 490.5 million pounds
`;

describe('parseColdStorage', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ scrapeUrl: mockScrapeUrl })
    );
  });

  it('parses cold storage data and computes 5yr avg pct', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseColdStorage('test-api-key', MOCK_SUPABASE_DATA);
    expect(result.total_beef_million_lbs).toBe(490.5);
    expect(result.month).toBe(3);
    expect(result.year).toBe(2026);
    // 5yr avg = (480+470+460+455+450)/5 = 463
    // vs_5yr_avg_pct = ((490.5 - 463) / 463) * 100 ≈ 5.94
    expect(result.vs_5yr_avg_pct).toBeCloseTo(5.94, 1);
    expect(result.source_hash).toHaveLength(64);
  });

  it('computes 0% when no historical data available', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseColdStorage('test-api-key', []);
    expect(result.vs_5yr_avg_pct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/usda-cold-storage.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/parsers/usda-cold-storage'`

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/usda-cold-storage.ts
import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { ColdStorageRecord } from '../types';
import { ParseError } from '../types';

// USDA Cold Storage summary page — use their main landing page
// as the PDF URL varies by month. Firecrawl will extract markdown.
const REPORT_URL = 'https://www.nass.usda.gov/Publications/Todays_Reports/reports/cofd0426.pdf';

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

function extractBeefLbs(text: string): number | null {
  const match = text.match(/Total Beef[^:]*:\s*([\d,]+\.?\d*)\s*million/i);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

function extractMonthYear(text: string): { month: number; year: number } | null {
  // "March 2026" or "MARCH 2026"
  const match = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  if (!match) return null;
  return { month: MONTH_NAMES[match[1].toLowerCase()], year: parseInt(match[2], 10) };
}

export async function parseColdStorage(
  apiKey: string,
  historicalRows: Array<{ total_beef_million_lbs: number }>
): Promise<ColdStorageRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await app.scrapeUrl(REPORT_URL, { formats: ['markdown'] });
  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for cold storage report');
  }

  const hash = sha256(markdown);
  const total_beef_million_lbs = extractBeefLbs(markdown);
  const monthYear = extractMonthYear(markdown);

  if (total_beef_million_lbs === null) {
    throw new ParseError('Could not extract total beef lbs from cold storage report');
  }
  if (monthYear === null) {
    throw new ParseError('Could not extract month/year from cold storage report');
  }

  // Compute vs 5yr avg from passed-in historical rows (last 60 months)
  let vs_5yr_avg_pct = 0;
  if (historicalRows.length > 0) {
    const avg =
      historicalRows.reduce((sum, r) => sum + r.total_beef_million_lbs, 0) /
      historicalRows.length;
    vs_5yr_avg_pct = avg > 0 ? ((total_beef_million_lbs - avg) / avg) * 100 : 0;
  }

  return {
    month: monthYear.month,
    year: monthYear.year,
    total_beef_million_lbs,
    vs_5yr_avg_pct: parseFloat(vs_5yr_avg_pct.toFixed(2)),
    source_hash: hash,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/parsers/usda-cold-storage.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/usda-cold-storage.ts tests/parsers/usda-cold-storage.test.ts
git commit -m "feat: add USDA cold storage parser with 5yr avg computation"
```

---

## Task 10: USDA Cutout Parser

**Files:**
- Create: `lib/parsers/usda-cutout.ts`
- Create: `tests/parsers/usda-cutout.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/usda-cutout.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(() => ({ scrapeUrl: vi.fn() })),
}));

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseCutout } from '../../lib/parsers/usda-cutout';

const MOCK_MARKDOWN = `
LM_XB459 - Daily Boxed Beef Cutout
Report Date: April 10, 2026

Choice Total: 302.50
Select Total: 288.00
Choice-Select Spread: 14.50

Primal Values:
Chuck: 230.00
Rib: 420.00
Loin: 380.00
Round: 220.00
Brisket: 210.00
Short Plate: 175.00
Flank: 195.00
`;

describe('parseCutout', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ scrapeUrl: mockScrapeUrl })
    );
  });

  it('parses all cutout fields', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseCutout('test-api-key');
    expect(result.choice_total).toBe(302.5);
    expect(result.select_total).toBe(288.0);
    expect(result.choice_select_spread).toBe(14.5);
    expect(result.chuck).toBe(230.0);
    expect(result.rib).toBe(420.0);
    expect(result.loin).toBe(380.0);
    expect(result.round).toBe(220.0);
    expect(result.brisket).toBe(210.0);
    expect(result.short_plate).toBe(175.0);
    expect(result.flank).toBe(195.0);
    expect(result.source_hash).toHaveLength(64);
  });

  it('returns report_type from report header', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseCutout('test-api-key');
    expect(result.report_type).toBe('LM_XB459');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/usda-cutout.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/parsers/usda-cutout'`

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/usda-cutout.ts
import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { CutoutRecord } from '../types';
import { ParseError } from '../types';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2466.pdf';

function extractPrice(text: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}[:\\s]+(\\d+\\.\\d+)`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  return parseFloat(match[1]);
}

function extractReportType(text: string): string {
  const match = text.match(/^(LM_\w+)/m);
  return match ? match[1] : 'Unknown';
}

function extractDate(text: string): string {
  const match = text.match(/Report Date[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
  if (match) {
    const parsed = new Date(match[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

export async function parseCutout(apiKey: string): Promise<CutoutRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await app.scrapeUrl(REPORT_URL, { formats: ['markdown'] });
  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for cutout report');
  }

  const hash = sha256(markdown);
  const choice_total = extractPrice(markdown, 'Choice Total');
  const select_total = extractPrice(markdown, 'Select Total');
  const choice_select_spread = extractPrice(markdown, 'Choice-Select Spread');
  const chuck = extractPrice(markdown, 'Chuck');
  const rib = extractPrice(markdown, 'Rib');
  const loin = extractPrice(markdown, 'Loin');
  const round = extractPrice(markdown, 'Round');
  const brisket = extractPrice(markdown, 'Brisket');
  const short_plate = extractPrice(markdown, 'Short Plate');
  const flank = extractPrice(markdown, 'Flank');

  const missing = (
    [
      ['choice_total', choice_total],
      ['select_total', select_total],
      ['chuck', chuck],
      ['rib', rib],
      ['loin', loin],
      ['round', round],
      ['brisket', brisket],
      ['short_plate', short_plate],
      ['flank', flank],
    ] as [string, number | null][]
  )
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new ParseError(`Could not extract fields from cutout report: ${missing.join(', ')}`);
  }

  return {
    date: extractDate(markdown),
    report_type: extractReportType(markdown),
    choice_total: choice_total!,
    select_total: select_total!,
    choice_select_spread: choice_select_spread ?? choice_total! - select_total!,
    chuck: chuck!,
    rib: rib!,
    loin: loin!,
    round: round!,
    brisket: brisket!,
    short_plate: short_plate!,
    flank: flank!,
    source_hash: hash,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/parsers/usda-cutout.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/usda-cutout.ts tests/parsers/usda-cutout.test.ts
git commit -m "feat: add USDA cutout parser with all primal values"
```

---

## Task 11: Futures Scraper (Playwright)

**Files:**
- Create: `lib/parsers/futures-scraper.ts`
- Create: `tests/parsers/futures-scraper.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parsers/futures-scraper.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock playwright before importing scraper
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(null),
        waitForSelector: vi.fn().mockResolvedValue(null),
        evaluate: vi.fn(),
        close: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

import { chromium } from 'playwright';
import { scrapeFutures } from '../../lib/parsers/futures-scraper';

describe('scrapeFutures', () => {
  it('returns a FuturesSnapshot on successful scrape', async () => {
    const mockPage = {
      goto: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn().mockResolvedValue({
        contract: 'LCM26',
        price: 190.5,
        change: -1.25,
        changePct: -0.65,
      }),
      close: vi.fn(),
    };
    const mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn(),
    };
    (chromium.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

    const result = await scrapeFutures();
    expect(result).not.toBeNull();
    expect(result!.front_month_contract).toBe('LCM26');
    expect(result!.front_month_price).toBe(190.5);
    expect(result!.change_today).toBe(-1.25);
    expect(result!.change_pct).toBe(-0.65);
    expect(result!.source).toBe('agribeef_scrape');
    expect(result!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null when page fails to load', async () => {
    const mockBrowser = {
      newPage: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
      close: vi.fn(),
    };
    (chromium.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

    const result = await scrapeFutures();
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/futures-scraper.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/parsers/futures-scraper'`

- [ ] **Step 3: Implement the scraper**

```typescript
// lib/parsers/futures-scraper.ts
import { chromium } from 'playwright';
import type { FuturesSnapshot } from '../types';

const AGRIBEEF_URL = 'https://www.agribeef.com/market-quotes/';
const FUTURES_SELECTOR = '[class*="futures"], [class*="market"], table'; // adapt after live inspection
const TIMEOUT_MS = 30_000;

interface RawFuturesData {
  contract: string;
  price: number;
  change: number;
  changePct: number;
}

export async function scrapeFutures(): Promise<FuturesSnapshot | null> {
  let browser;
  try {
    browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    });
    const page = await browser.newPage();

    await page.goto(AGRIBEEF_URL, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    await page.waitForSelector(FUTURES_SELECTOR, { timeout: TIMEOUT_MS });

    const raw: RawFuturesData | null = await page.evaluate(() => {
      // Adapt this selector to match the actual Agri Beef DOM structure.
      // This targets the first row of a futures/quotes table.
      const rows = document.querySelectorAll('table tr, [class*="quote-row"], [class*="futures-row"]');
      if (!rows.length) return null;

      const firstRow = rows[0];
      const cells = firstRow.querySelectorAll('td, [class*="cell"]');
      if (cells.length < 3) return null;

      const contract = cells[0]?.textContent?.trim() ?? '';
      const price = parseFloat(cells[1]?.textContent?.replace(/[^0-9.-]/g, '') ?? '0');
      const change = parseFloat(cells[2]?.textContent?.replace(/[^0-9.-]/g, '') ?? '0');
      const changePct = parseFloat(cells[3]?.textContent?.replace(/[^0-9.%-]/g, '') ?? '0');

      if (!contract || isNaN(price)) return null;
      return { contract, price, change, changePct };
    });

    await page.close();

    if (!raw) {
      console.warn('[futures-scraper] Could not extract data from Agri Beef page');
      return null;
    }

    return {
      timestamp: new Date().toISOString(),
      front_month_contract: raw.contract,
      front_month_price: raw.price,
      change_today: raw.change,
      change_pct: raw.changePct,
      source: 'agribeef_scrape',
    };
  } catch (err) {
    console.error('[futures-scraper] Scrape failed:', err);
    return null;
  } finally {
    await browser?.close();
  }
}
```

> **Note:** The `page.evaluate` selector logic (`FUTURES_SELECTOR` and the `querySelectorAll` targets) must be tuned after a live inspection of `https://www.agribeef.com/market-quotes/`. Use Playwright's `browser.newPage()` in non-headless mode and inspect the DOM to find the exact class names for the futures table.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/parsers/futures-scraper.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/futures-scraper.ts tests/parsers/futures-scraper.test.ts
git commit -m "feat: add Playwright futures scraper for Agri Beef"
```

---

## Task 12: Edge Function — ingest-negotiated

**Files:**
- Create: `supabase/functions/ingest-negotiated/index.ts`

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/ingest-negotiated/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2453.pdf';
const SOURCE = 'usda_negotiated';
const THIN_THRESHOLD = 10;

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  const now = new Date().toISOString();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    // Fetch PDF via Firecrawl
    const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: REPORT_URL, formats: ['markdown'] }),
    });
    if (!fcRes.ok) throw new Error(`Firecrawl error: ${fcRes.status}`);
    const fcData = await fcRes.json();
    const markdown: string = fcData?.data?.markdown ?? '';
    if (!markdown.trim()) throw new Error('Empty markdown from Firecrawl');

    sourceHash = await sha256Deno(markdown);

    // Duplicate check
    const { data: existing } = await supabase
      .from('negotiated_sales')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    // Parse fields
    const sessionMatch = markdown.match(/Session[:\s]+(AM|PM)/i);
    const session = sessionMatch ? sessionMatch[1].toUpperCase() as 'AM' | 'PM' : 'AM';

    const dateMatch = markdown.match(/(\w+ \d{1,2},?\s*\d{4})/);
    const date = dateMatch ? new Date(dateMatch[1]).toISOString().split('T')[0] : now.split('T')[0];

    const extractNum = (label: string) => {
      const m = markdown.match(new RegExp(`${label}[:\\s]+([\\d,.]+)`, 'i'));
      return m ? parseFloat(m[1].replace(/,/g, '')) : null;
    };

    const low = extractNum('Low Price');
    const high = extractNum('High Price');
    const weighted_avg = extractNum('Weighted Average');
    const volume_loads = extractNum('Volume');

    // Validate
    if (weighted_avg === null || weighted_avg < 150 || weighted_avg > 400) {
      throw new Error(`weighted_avg ${weighted_avg} outside valid range [$150–$400/cwt]`);
    }
    if (volume_loads === null || volume_loads < 0 || volume_loads > 500) {
      throw new Error(`volume_loads ${volume_loads} outside valid range [0–500]`);
    }

    const { error } = await supabase.from('negotiated_sales').insert({
      date,
      session,
      low,
      high,
      weighted_avg,
      volume_loads,
      session_quality: volume_loads < THIN_THRESHOLD ? 'thin' : 'active',
      source_hash: sourceHash,
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({
      source: SOURCE,
      source_hash: sourceHash,
      status: 'failed',
      error_message: err.message,
      records_inserted: 0,
    });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/ingest-negotiated/
git commit -m "feat: add ingest-negotiated Edge Function"
```

---

## Task 13: Edge Function — ingest-slaughter

**Files:**
- Create: `supabase/functions/ingest-slaughter/index.ts`

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/ingest-slaughter/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_3208.pdf';
const SOURCE = 'usda_slaughter';

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: REPORT_URL, formats: ['markdown'] }),
    });
    if (!fcRes.ok) throw new Error(`Firecrawl error: ${fcRes.status}`);
    const fcData = await fcRes.json();
    const markdown: string = fcData?.data?.markdown ?? '';
    if (!markdown.trim()) throw new Error('Empty markdown from Firecrawl');

    sourceHash = await sha256Deno(markdown);

    const { data: existing } = await supabase
      .from('slaughter_weekly')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const weekMatch = markdown.match(/Week Ending[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
    const week_ending = weekMatch
      ? new Date(weekMatch[1]).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const extractHead = (label: string) => {
      const m = markdown.match(new RegExp(`${label}[:\\s]+([\\d,]+)`, 'i'));
      return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
    };

    const total_head = extractHead('Total Head Slaughtered');
    const steer_count = extractHead('Steers');
    const heifer_count = extractHead('Heifers');

    if (total_head === null || total_head < 400_000 || total_head > 700_000) {
      throw new Error(`total_head ${total_head} outside valid range [400k–700k]`);
    }

    const total = (steer_count ?? 0) + (heifer_count ?? 0);
    const steer_heifer_ratio = total > 0 ? (steer_count ?? 0) / total : 0;

    if (steer_heifer_ratio < 0.3 || steer_heifer_ratio > 0.7) {
      throw new Error(`steer_heifer_ratio ${steer_heifer_ratio.toFixed(4)} outside valid range [0.3–0.7]`);
    }

    const { error } = await supabase.from('slaughter_weekly').insert({
      week_ending,
      total_head,
      steer_count,
      heifer_count,
      steer_heifer_ratio,
      source_hash: sourceHash,
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/ingest-slaughter/
git commit -m "feat: add ingest-slaughter Edge Function"
```

---

## Task 14: Edge Function — ingest-cold-storage

**Files:**
- Create: `supabase/functions/ingest-cold-storage/index.ts`

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/ingest-cold-storage/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.nass.usda.gov/Publications/Todays_Reports/reports/cofd0426.pdf';
const SOURCE = 'usda_cold_storage';

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: REPORT_URL, formats: ['markdown'] }),
    });
    if (!fcRes.ok) throw new Error(`Firecrawl error: ${fcRes.status}`);
    const fcData = await fcRes.json();
    const markdown: string = fcData?.data?.markdown ?? '';
    if (!markdown.trim()) throw new Error('Empty markdown from Firecrawl');

    sourceHash = await sha256Deno(markdown);

    // Extract values
    const beefMatch = markdown.match(/Total Beef[^:]*:\s*([\d,]+\.?\d*)\s*million/i);
    const total_beef_million_lbs = beefMatch ? parseFloat(beefMatch[1].replace(/,/g, '')) : null;
    if (total_beef_million_lbs === null) throw new Error('Could not extract total beef lbs');

    const monthYearMatch = markdown.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
    if (!monthYearMatch) throw new Error('Could not extract month/year');
    const month = MONTH_NAMES[monthYearMatch[1].toLowerCase()];
    const year = parseInt(monthYearMatch[2], 10);

    // Duplicate check
    const { data: existing } = await supabase
      .from('cold_storage_monthly')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    // Compute vs 5yr avg from last 60 months in DB
    const { data: historical } = await supabase
      .from('cold_storage_monthly')
      .select('total_beef_million_lbs')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(60);

    let vs_5yr_avg_pct = 0;
    if (historical && historical.length > 0) {
      const avg = historical.reduce((s: number, r: { total_beef_million_lbs: number }) => s + r.total_beef_million_lbs, 0) / historical.length;
      vs_5yr_avg_pct = avg > 0 ? parseFloat((((total_beef_million_lbs - avg) / avg) * 100).toFixed(2)) : 0;
    }

    const { error } = await supabase.from('cold_storage_monthly').insert({
      month,
      year,
      total_beef_million_lbs,
      vs_5yr_avg_pct,
      source_hash: sourceHash,
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/ingest-cold-storage/
git commit -m "feat: add ingest-cold-storage Edge Function"
```

---

## Task 15: Edge Function — ingest-cutout

**Files:**
- Create: `supabase/functions/ingest-cutout/index.ts`

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/ingest-cutout/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2466.pdf';
const SOURCE = 'usda_cutout';

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: REPORT_URL, formats: ['markdown'] }),
    });
    if (!fcRes.ok) throw new Error(`Firecrawl error: ${fcRes.status}`);
    const fcData = await fcRes.json();
    const markdown: string = fcData?.data?.markdown ?? '';
    if (!markdown.trim()) throw new Error('Empty markdown from Firecrawl');

    sourceHash = await sha256Deno(markdown);

    const { data: existing } = await supabase
      .from('cutout_daily')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const extractPrice = (label: string) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = markdown.match(new RegExp(`${escaped}[:\\s]+([\\d.]+)`, 'i'));
      return m ? parseFloat(m[1]) : null;
    };

    const reportTypeMatch = markdown.match(/^(LM_\w+)/m);
    const report_type = reportTypeMatch ? reportTypeMatch[1] : 'Unknown';

    const dateMatch = markdown.match(/Report Date[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
    const date = dateMatch
      ? new Date(dateMatch[1]).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const choice_total = extractPrice('Choice Total');
    const select_total = extractPrice('Select Total');
    const chuck = extractPrice('Chuck');
    const rib = extractPrice('Rib');
    const loin = extractPrice('Loin');
    const round = extractPrice('Round');
    const brisket = extractPrice('Brisket');
    const short_plate = extractPrice('Short Plate');
    const flank = extractPrice('Flank');

    const missing = ['choice_total', 'select_total', 'chuck', 'rib', 'loin', 'round', 'brisket', 'short_plate', 'flank']
      .filter((k) => ({ choice_total, select_total, chuck, rib, loin, round, brisket, short_plate, flank } as Record<string, number | null>)[k] === null);

    if (missing.length > 0) {
      throw new Error(`Could not extract cutout fields: ${missing.join(', ')}`);
    }

    const { error } = await supabase.from('cutout_daily').insert({
      date,
      report_type,
      choice_total,
      select_total,
      choice_select_spread: (choice_total ?? 0) - (select_total ?? 0),
      chuck,
      rib,
      loin,
      round,
      brisket,
      short_plate,
      flank,
      source_hash: sourceHash,
      updated_at: new Date().toISOString(),
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/ingest-cutout/
git commit -m "feat: add ingest-cutout Edge Function"
```

---

## Task 16: Edge Function — ingest-futures

**Files:**
- Create: `supabase/functions/ingest-futures/index.ts`

> **Important:** Playwright cannot run inside Supabase Edge Functions (no browser runtime). This function calls the Agri Beef page via `fetch` + DOM parsing with a regex approach as a lightweight alternative. If richer Playwright scraping is needed, deploy the `lib/parsers/futures-scraper.ts` as a separate scheduled job (e.g., Railway, Fly.io, or a cron on a VPS) and have it POST results to a `/ingest-futures` HTTP endpoint.

- [ ] **Step 1: Write the Edge Function (fetch-based)**

```typescript
// supabase/functions/ingest-futures/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog } from '../_shared/log.ts';

const AGRIBEEF_URL = 'https://www.agribeef.com/market-quotes/';
const SOURCE = 'usda_futures_agribeef';

// Market hours check: 8:30 AM – 1:05 PM CT (UTC-5/UTC-6)
function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;

  // CT offset: UTC-6 in CST, UTC-5 in CDT. Use UTC-6 as conservative.
  const ctHour = now.getUTCHours() - 6;
  const ctMinute = now.getUTCMinutes();
  const ctTime = ctHour * 60 + ctMinute;
  const open = 8 * 60 + 30;  // 8:30
  const close = 13 * 60 + 5; // 13:05
  return ctTime >= open && ctTime <= close;
}

serve(async (req: Request) => {
  // Allow bypass via query param for manual testing
  const url = new URL(req.url);
  const forceRun = url.searchParams.get('force') === 'true';

  if (!forceRun && !isMarketHours()) {
    return new Response(JSON.stringify({ status: 'skipped', reason: 'outside market hours' }), { status: 200 });
  }

  const supabase = getServiceClient();

  try {
    // Fetch the Agri Beef page HTML
    const pageRes = await fetch(AGRIBEEF_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HighlineBot/1.0)' },
    });
    if (!pageRes.ok) throw new Error(`Fetch failed: ${pageRes.status}`);
    const html = await pageRes.text();

    // Extract futures data via regex on the HTML
    // Patterns will need to be tuned after inspecting the live page HTML
    const contractMatch = html.match(/LC[A-Z]\d{2}|Live Cattle [A-Z][a-z]{2} '\d{2}/);
    const priceMatch = html.match(/(\d{3}\.\d{2,3})/);
    const changeMatch = html.match(/([+-]\d+\.\d+)\s*(?:pts?|<)/);
    const changePctMatch = html.match(/([+-]\d+\.\d+)%/);

    if (!contractMatch || !priceMatch) {
      throw new Error('Could not extract futures contract/price from Agri Beef HTML');
    }

    const snapshot = {
      timestamp: new Date().toISOString(),
      front_month_contract: contractMatch[0],
      front_month_price: parseFloat(priceMatch[1]),
      change_today: changeMatch ? parseFloat(changeMatch[1]) : 0,
      change_pct: changePctMatch ? parseFloat(changePctMatch[1]) : 0,
      source: 'agribeef_scrape',
    };

    const { error } = await supabase.from('futures_snapshots').insert(snapshot);
    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: null, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', snapshot }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: null, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/ingest-futures/
git commit -m "feat: add ingest-futures Edge Function with market hours guard"
```

---

## Task 17: Data Access Layer — queries.ts

**Files:**
- Create: `lib/supabase/queries.ts`
- Create: `tests/queries/queries.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/queries/queries.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the client module
vi.mock('../../lib/supabase/client', () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from '../../lib/supabase/client';
import {
  getLatestCutout,
  getCutoutHistory,
  getTodayNegotiated,
  getNegotiatedHistory,
  getLatestSlaughter,
  getLatestColdStorage,
  getLatestFutures,
  getDataHealth,
} from '../../lib/supabase/queries';

const MOCK_CUTOUT = {
  id: 'uuid-1',
  date: '2026-04-10',
  report_type: 'LM_XB459',
  choice_total: 302.5,
  select_total: 288.0,
  choice_select_spread: 14.5,
  chuck: 230.0,
  rib: 420.0,
  loin: 380.0,
  round: 220.0,
  brisket: 210.0,
  short_plate: 175.0,
  flank: 195.0,
  source_hash: 'abc123',
  created_at: '2026-04-10T11:05:00Z',
  updated_at: '2026-04-10T11:05:00Z',
};

function makeChain(data: unknown, error = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ data: Array.isArray(data) ? data : [data], error }),
  };
  return chain;
}

describe('getLatestCutout', () => {
  it('returns the most recent cutout row', async () => {
    const mockChain = makeChain(MOCK_CUTOUT);
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    });
    const result = await getLatestCutout();
    expect(result?.choice_total).toBe(302.5);
  });
});

describe('getDataHealth', () => {
  it('marks negotiated stale when last update > 4 hours ago', async () => {
    const staleTime = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const mockChain = makeChain({ created_at: staleTime });
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    });
    const health = await getDataHealth();
    const neg = health.find((h) => h.source === 'negotiated_sales');
    expect(neg?.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/queries/queries.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/supabase/queries'`

- [ ] **Step 3: Implement queries.ts**

```typescript
// lib/supabase/queries.ts
import { createServiceClient } from './client';
import type {
  CutoutDailyRow,
  NegotiatedSalesRow,
  SlaughterWeeklyRow,
  ColdStorageMonthlyRow,
  FuturesSnapshotRow,
  DataHealthStatus,
} from '../types';

// Stale thresholds in milliseconds
const STALE_MS = {
  negotiated_sales: 4 * 60 * 60 * 1000,       // 4 hours
  slaughter_weekly: 8 * 24 * 60 * 60 * 1000,  // 8 days
  cold_storage_monthly: 35 * 24 * 60 * 60 * 1000, // 35 days
  futures_snapshots: 45 * 60 * 1000,           // 45 minutes
};

export async function getLatestCutout(): Promise<CutoutDailyRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('cutout_daily')
    .select('*')
    .order('date', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as CutoutDailyRow;
}

export async function getCutoutHistory(days: number): Promise<CutoutDailyRow[]> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('cutout_daily')
    .select('*')
    .gte('date', since)
    .order('date', { ascending: false });
  if (error) return [];
  return (data ?? []) as CutoutDailyRow[];
}

export async function getTodayNegotiated(): Promise<NegotiatedSalesRow[]> {
  const supabase = createServiceClient();
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('negotiated_sales')
    .select('*')
    .eq('date', today)
    .order('session', { ascending: true });
  if (error) return [];
  return (data ?? []) as NegotiatedSalesRow[];
}

export async function getNegotiatedHistory(days: number): Promise<NegotiatedSalesRow[]> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('negotiated_sales')
    .select('*')
    .gte('date', since)
    .order('date', { ascending: false });
  if (error) return [];
  return (data ?? []) as NegotiatedSalesRow[];
}

export async function getLatestSlaughter(): Promise<SlaughterWeeklyRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('slaughter_weekly')
    .select('*')
    .order('week_ending', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as SlaughterWeeklyRow;
}

export async function getLatestColdStorage(): Promise<ColdStorageMonthlyRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('cold_storage_monthly')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as ColdStorageMonthlyRow;
}

export async function getLatestFutures(): Promise<FuturesSnapshotRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('futures_snapshots')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as FuturesSnapshotRow;
}

export async function getDataHealth(): Promise<DataHealthStatus[]> {
  const supabase = createServiceClient();
  const now = Date.now();

  async function getLastUpdated(table: string, timestampCol: string): Promise<string | null> {
    const { data } = await supabase
      .from(table)
      .select(timestampCol)
      .order(timestampCol, { ascending: false })
      .limit(1)
      .single();
    return (data as Record<string, string> | null)?.[timestampCol] ?? null;
  }

  const [negUpdated, slaughterUpdated, coldUpdated, futuresUpdated] = await Promise.all([
    getLastUpdated('negotiated_sales', 'created_at'),
    getLastUpdated('slaughter_weekly', 'created_at'),
    getLastUpdated('cold_storage_monthly', 'created_at'),
    getLastUpdated('futures_snapshots', 'created_at'),
  ]);

  function checkStale(
    source: string,
    lastUpdated: string | null,
    thresholdMs: number,
    onlyDuringMarketHours = false
  ): DataHealthStatus {
    if (!lastUpdated) {
      return { source, last_updated: null, stale: true, stale_reason: 'No data yet' };
    }
    const age = now - new Date(lastUpdated).getTime();
    const stale = age > thresholdMs;
    return {
      source,
      last_updated: lastUpdated,
      stale,
      stale_reason: stale ? `Last update was ${Math.round(age / 60000)} minutes ago` : null,
    };
  }

  return [
    checkStale('negotiated_sales', negUpdated, STALE_MS.negotiated_sales),
    checkStale('slaughter_weekly', slaughterUpdated, STALE_MS.slaughter_weekly),
    checkStale('cold_storage_monthly', coldUpdated, STALE_MS.cold_storage_monthly),
    checkStale('futures_snapshots', futuresUpdated, STALE_MS.futures_snapshots, true),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/queries/queries.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: all test suites pass.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/queries.ts tests/queries/queries.test.ts
git commit -m "feat: add typed data access layer with health checks"
```

---

## Task 18: pg_cron Schedules

**Files:**
- Create: `supabase/migrations/20260410000003_pg_cron_schedules.sql`

- [ ] **Step 1: Write the cron migration**

```sql
-- supabase/migrations/20260410000003_pg_cron_schedules.sql
-- Requires pg_cron extension (enabled by default on Supabase Pro)

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Negotiated sales + Cutout: 11:00 AM CT (17:00 UTC) and 3:30 PM CT (21:30 UTC), Mon–Fri
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

-- Slaughter: Monday 6:00 AM CT (12:00 UTC)
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

-- Cold storage: 1st of month 6:00 AM CT (12:00 UTC)
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

-- Futures: every 30 minutes Mon–Fri (function itself guards market hours)
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
```

> **Note:** `current_setting('app.supabase_url')` and `current_setting('app.service_role_key')` must be set via Supabase dashboard → Project Settings → Database → Custom Config, or set with `ALTER DATABASE postgres SET app.supabase_url = '...'` in a migration.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260410000003_pg_cron_schedules.sql
git commit -m "feat: add pg_cron schedules for all ingestion functions"
```

---

## Task 19: TypeScript Full Compile Check

- [ ] **Step 1: Run tsc on the full project**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run the full test suite with coverage**

```bash
npx vitest run --coverage
```

Expected: all tests pass, coverage report generated.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: full compile + test suite passing — Phase 1 data ingestion complete"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec Requirement | Task |
|---|---|
| `cutout_daily` table | Task 4 |
| `negotiated_sales` table | Task 4 |
| `slaughter_weekly` table | Task 4 |
| `cold_storage_monthly` table | Task 4 |
| `futures_snapshots` table | Task 4 |
| `ingestion_log` table | Task 4 |
| RLS — authenticated SELECT | Task 4 |
| RLS — service role INSERT only | Task 4 |
| `lib/parsers/usda-negotiated.ts` | Task 7 |
| `lib/parsers/usda-slaughter.ts` | Task 8 |
| `lib/parsers/usda-cold-storage.ts` | Task 9 |
| `lib/parsers/usda-cutout.ts` | Task 10 |
| `lib/parsers/futures-scraper.ts` | Task 11 |
| SHA-256 hash dedup | Tasks 3, 7–11 |
| Validation + ParseError | Tasks 7–10 |
| ingestion_log on every outcome | Tasks 12–16 |
| `ingest-negotiated` Edge Function | Task 12 |
| `ingest-slaughter` Edge Function | Task 13 |
| `ingest-cold-storage` Edge Function | Task 14 |
| `ingest-cutout` Edge Function | Task 15 |
| `ingest-futures` Edge Function | Task 16 |
| `lib/supabase/queries.ts` — all 8 queries | Task 17 |
| `getDataHealth()` with stale flags | Task 17 |
| pg_cron schedules (all 5 functions) | Task 18 |

**Known limitations to note:**

1. **Futures scraper in Edge Function:** Playwright requires a full browser runtime which Supabase Edge Functions do not provide. Task 16 uses `fetch` + HTML regex parsing as a fallback. For production, deploy `lib/parsers/futures-scraper.ts` as a cron job on a server that can run Playwright (Railway, Fly.io, or a VM).

2. **USDA PDF URLs:** The exact PDF URLs for cold storage (`cofd0426.pdf`) and the report IDs change monthly. A URL discovery step (fetching the USDA index page) should be added before scraping in production.

3. **Firecrawl PDF parsing accuracy:** USDA PDFs have inconsistent formatting. The regex-based field extraction in parsers will need tuning against real PDF output during integration testing. Run each parser manually with a live Firecrawl API key before relying on them.

4. **pg_cron app settings:** The `current_setting('app.supabase_url')` approach requires those settings to be configured on the Supabase project. Alternatively, hard-code the project URL in the migration (less flexible but works out of the box).
