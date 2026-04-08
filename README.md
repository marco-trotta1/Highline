# Highline

**Pricing intelligence platform for AB Foods boxed beef sales operations.**

Highline replaces salesman intuition with signal-based pricing guidance. It ingests live USDA market data, cattle futures, and slaughter rates to generate directional confidence scores and recommended price ranges — by brand, grade, product, and channel — so the desk can consistently outperform the USDA national boxed beef cutout.

---

## Problem

Boxed beef margins are won or lost in fractions of a cent per pound. The current process depends on a pricing manager manually synthesizing USDA reports, futures movement, and market feel to set daily prices across all channels and brands. That process is slow, non-repeatable, and exits the building when the pricing manager does.

Highline makes that logic explicit, auditable, and fast.

---

## What It Does

- Ingests live USDA AMS negotiated sales (morning and afternoon), slaughter rates, and cold storage data
- Pulls live cattle futures from AgriBeef
- Synthesizes signals into a bull/bear directional score with confidence level
- Generates recommended price ranges by brand, grade, product, and fresh/frozen channel
- Tracks internal price list vs. USDA cutout in real time
- Maintains historical data for trend analysis and model training

---

## Target Users

| Role | Use Case |
|---|---|
| Pricing Manager | Set and monitor daily prices across all channels and brands |
| Salesperson | Price market bids with signal-backed confidence |
| Sales Director | Margin visibility by customer, product, brand, and channel |

---

## Data Sources

| Source | Description | Endpoint |
|---|---|---|
| USDA AMS Negotiated Sales | Morning and afternoon reported trades | [ams_2453.pdf](https://www.ams.usda.gov/mnreports/ams_2453.pdf) |
| USDA Fed Cattle Slaughter | Daily steer/heifer slaughter rates | [ams_3208.pdf](https://www.ams.usda.gov/mnreports/ams_3208.pdf) |
| USDA AMS API | Boxed beef cutout values | AMS API |
| Live Cattle Futures | CME futures prices | [agribeef.com](https://www.agribeef.com/market-quotes/) |
| Cold Storage / National Inventory | USDA cold storage reports | USDA AMS |
| Internal Inventory | AB Foods position data | *(Phase 2)* |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Frontend                         │
│              React · Tailwind · Recharts                │
└────────────────────────┬────────────────────────────────┘
                         │ REST / WebSocket
┌────────────────────────▼────────────────────────────────┐
│                    API Layer (FastAPI)                   │
│         Async ingestion · Signal engine · Auth          │
└──────┬──────────────────────────┬───────────────────────┘
       │                          │
┌──────▼──────┐          ┌────────▼────────┐
│  PostgreSQL  │          │     Redis       │
│  Historical  │          │  Live cache     │
│  data store  │          │  (TTL per feed) │
└─────────────┘          └─────────────────┘
```

**Stack:**
- **Backend:** Python 3.11+, FastAPI, async ingestion workers
- **Frontend:** React, Tailwind CSS, Recharts
- **Database:** PostgreSQL (historical pricing and signal data)
- **Cache:** Redis (live market data, short TTL)
- **Deployment:** Docker Compose (internal), target: single-server or cloud VM

---

## Build Phases

### Phase 1 — Data Ingestion + Display
- [ ] USDA AMS PDF parsing (negotiated sales, slaughter rates)
- [ ] USDA AMS API integration (cutout values)
- [ ] AgriBeef futures scraping
- [ ] Redis caching layer with per-source TTL
- [ ] Basic dashboard: live market data display

### Phase 2 — Signal Engine
- [ ] Bull/bear directional score (weighted composite of signals)
- [ ] Confidence level output (low / medium / high)
- [ ] Price range recommendations by brand, grade, product, channel
- [ ] Cutout delta tracking (internal price list vs. USDA cutout)
- [ ] SKU-level margin visibility

### Phase 3 — Forward Positioning
- [ ] Historical price trend analysis
- [ ] Forward trade guidance with directional confidence
- [ ] Internal inventory integration
- [ ] Freight analytics module
- [ ] Compliance pricing enforcement layer

---

## Project Structure

```
highline/
├── backend/
│   ├── api/              # FastAPI routes
│   ├── ingestion/        # USDA and futures data workers
│   ├── signals/          # Bull/bear scoring logic
│   ├── models/           # DB models (SQLAlchemy)
│   └── cache/            # Redis interface
├── frontend/
│   ├── src/
│   │   ├── components/   # Dashboard, price tables, signal cards
│   │   ├── pages/        # Daily pricing, forward positions, SKU view
│   │   └── api/          # Frontend API client
├── infra/
│   ├── docker-compose.yml
│   └── nginx.conf
├── scripts/
│   └── seed_historical.py
├── tests/
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites
- Python 3.11+
- Node 18+
- Docker and Docker Compose
- PostgreSQL 15+
- Redis 7+

### Local Setup

```bash
# Clone the repo
git clone https://github.com/abfoods/highline.git
cd highline

# Backend
cp .env.example .env
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn api.main:app --reload

# Frontend
cd ../frontend
npm install
npm run dev

# Full stack (Docker)
docker compose up --build
```

---

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/highline
REDIS_URL=redis://localhost:6379
USDA_AMS_API_KEY=your_key_here
AGRIBEEF_BASE_URL=https://www.agribeef.com
```

---

## Key Metrics

The platform targets consistent outperformance of the USDA national boxed beef cutout by **$0.05–$0.15/cwt** across the carcass on negotiated and spot sales, measured weekly by channel and brand.

---

## Status

> **Active development — Phase 1**

Internal tool. Not open source.


