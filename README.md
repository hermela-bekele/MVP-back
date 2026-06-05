# Prime API

Express + PostgreSQL backend for the Prime Teaching System.

## Prerequisites

- Node.js 20+
- PostgreSQL with database **`Prime`** created:

```sql
CREATE DATABASE "Prime";
```

## Setup

```bash
npm install
cp .env.example .env   # adjust PG credentials if needed
npm run db:setup       # migrate schema + seed demo data
npm run dev
```

API health check: [http://localhost:3004/api/health](http://localhost:3004/api/health)

## Environment

| Variable | Example |
|----------|---------|
| `PORT` | `3004` |
| `NODE_ENV` | `production` |
| `PG_USER_NAME` | `postgres` |
| `PG_PASSWORD` | `password` |
| `PG_HOST` | `localhost` |
| `PG_PORT` | `5432` |
| `PG_DATABASE` | `Prime` |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | API server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled server |
| `npm run db:migrate` | Apply database schema |
| `npm run db:seed` | Seed demo data |
| `npm run db:setup` | Migrate + seed |

## API

All portal data is stored in PostgreSQL and loaded via `GET /api/bootstrap`. Mutations persist through REST endpoints under `/api/*`.

The frontend expects the API at `http://localhost:3004` by default, or the URL set in `NEXT_PUBLIC_API_URL`.
