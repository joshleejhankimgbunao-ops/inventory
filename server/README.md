# Inventory Backend (MERN)

Express + MongoDB API for the inventory frontend.

## 1) Setup

```bash
cd server
cp .env.example .env
```

Update `.env` values, especially `MONGO_URI` and `JWT_SECRET`.

## 2) Run

```bash
npm run dev
```

Server starts at `http://localhost:5000` by default.

## 2.1) Seed Sample Data

```bash
npm run seed
```

Use reset mode to wipe and reseed:

```bash
npm run seed:reset
```

Sample dev credentials are configurable via `SEED_*` env vars in `src/scripts/seed.js`.

## 3) Health Check

```bash
GET /api/health
```

## 4) Initial Routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (requires Bearer token)
- `PATCH /api/auth/me/preferences` (requires Bearer token)
- `PATCH /api/auth/me/profile` (requires Bearer token)
- `POST /api/auth/me/verify-password` (requires Bearer token)
- `POST /api/auth/me/verify-pin` (requires Bearer token)
- `GET /api/auth/users` (superadmin/admin only)
- `PATCH /api/auth/users/:username` (superadmin/admin only)
- `GET /api/products` (requires token)
- `POST /api/products` (superadmin/admin only)
- `PATCH /api/products/:id` (superadmin/admin only)
- `GET /api/sales` (superadmin/admin only)
- `POST /api/sales` (superadmin/admin/cashier)
- `GET /api/sales/history-view` (superadmin/admin; frontend transaction contract)
- `PATCH /api/sales/:id/archive` (superadmin/admin)
- `PATCH /api/sales/:id/restore` (superadmin/admin)
- `GET /api/settings` (public)
- `PATCH /api/settings` (superadmin/admin)
- `GET /api/partners` (authenticated)
- `POST /api/partners` (superadmin/admin)
- `PATCH /api/partners/:id` (superadmin/admin)
- `PATCH /api/partners/:id/archive` (superadmin/admin)
- `PATCH /api/partners/:id/restore` (superadmin/admin)
- `GET /api/logs/activity` (superadmin/admin)
- `GET /api/logs/inventory` (superadmin/admin)

## 5) Notes

- Roles are aligned with frontend roles: `superadmin`, `admin`, `cashier`.
- This is a starter scaffold; add validation, transactions, and audit logging next.
- Teammate handoff doc is in `server/HANDOFF.md`.

## 6) Phase 0 Safety Baseline

Before implementing new backend modules, run this baseline to avoid regressions.

### 6.1 Smoke Test

Make sure backend is running, then execute:

```bash
npm run smoke
```

The smoke test validates:
- `GET /api/health`
- login flow (with optional PIN challenge)
- `GET /api/auth/me`
- `GET /api/products`
- `GET /api/sales`

You can override credentials using env vars:
- `SMOKE_BASE_URL`
- `SMOKE_USERNAME`
- `SMOKE_PASSWORD`
- `SMOKE_PIN`

### 6.2 Database Backup

Prerequisite: install MongoDB Database Tools (`mongodump` / `mongorestore`) or set:
- `MONGODUMP_PATH` (absolute path to `mongodump.exe`)
- `MONGORESTORE_PATH` (absolute path to `mongorestore.exe`)

```bash
npm run db:backup
```

Default output folder:
- `server/backups/<timestamp>-inventory-dev`

### 6.3 Database Restore

```bash
npm run db:restore
```

Restore script accepts optional `-BackupPath` and `-DbName` parameters.

### 6.4 Rollback Checklist

If a migration or new phase causes issues:

1. Stop backend server.
2. Revert code changes to last stable commit/branch.
3. Restore latest DB backup using `npm run db:restore`.
4. Start server and run `npm run smoke`.
5. Resume work only when smoke test is green.

## 7) Phase 6 Product Enrichment

Products now support additional optional fields:
- `brand`
- `color`
- `size`
- `supplierName`

To backfill older product documents safely:

```bash
npm run migrate:products:phase6
```
