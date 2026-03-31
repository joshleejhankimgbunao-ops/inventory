# Backend Handoff Kit

This file is for teammates who need to run and continue backend work quickly.

## 1) Quick Start

1. Open terminal in `server/`
2. Install deps:
   - `npm install`
3. Create env file:
   - copy `.env.example` to `.env`
4. Start local MongoDB (or use Atlas URI in `.env`)
5. Seed sample data:
   - `npm run seed`
6. Run API:
   - `npm run dev`

API base URL: `http://localhost:5000`

## 2) Environment Variables

Required values in `.env`:

- `PORT=5000`
- `MONGO_URI=mongodb://127.0.0.1:27017/inventory-dev`
- `JWT_SECRET=replace-with-a-long-random-secret`
- `JWT_EXPIRES_IN=1d`
- `CLIENT_ORIGIN=http://localhost:5173`

## 3) Seed Credentials (Dev Only)

- Superadmin: `owner` / `Owner123!`
- Admin: `admin1` / `Admin123!`
- Cashier: `cashier1` / `Cashier123!`

## 4) API Endpoints

### Health
- `GET /api/health`

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `PATCH /api/auth/me/preferences` (Bearer token)
- `PATCH /api/auth/me/profile` (Bearer token)
- `POST /api/auth/me/verify-password` (Bearer token)
- `POST /api/auth/me/verify-pin` (Bearer token)
- `GET /api/auth/users` (superadmin/admin)
- `PATCH /api/auth/users/:username` (superadmin/admin)

### Products
- `GET /api/products` (Bearer token)
- `POST /api/products` (superadmin/admin)
- `PATCH /api/products/:id` (superadmin/admin)

### Sales
- `GET /api/sales` (superadmin/admin)
- `POST /api/sales` (superadmin/admin/cashier)
- `GET /api/sales/history-view` (superadmin/admin; frontend transaction contract)
- `PATCH /api/sales/:id/archive` (superadmin/admin)
- `PATCH /api/sales/:id/restore` (superadmin/admin)

### Settings
- `GET /api/settings` (public)
- `PATCH /api/settings` (superadmin/admin)

### Partners
- `GET /api/partners` (authenticated)
- `POST /api/partners` (superadmin/admin)
- `PATCH /api/partners/:id` (superadmin/admin)
- `PATCH /api/partners/:id/archive` (superadmin/admin)
- `PATCH /api/partners/:id/restore` (superadmin/admin)

### Logs
- `GET /api/logs/activity` (superadmin/admin)
- `GET /api/logs/inventory` (superadmin/admin)

## 5) Frontend Integration Notes

Frontend already has API service wrappers in:
- `src/services/apiClient.js`
- `src/services/authApi.js`
- `src/services/inventoryApi.js`

Current setup is mixed mode:
- backend-first on auth/products/sales paths,
- with fallback behavior still present in some legacy UI flows.

## 6) Team Workflow Suggestion

- Assign one owner for backend models/routes per sprint task.
- Keep route contracts stable before changing frontend calls.
- If route response changes, update service wrappers first, then UI.

## 7) Phase 0 (Safe Baseline Before New Backend Work)

Run these before starting Phase 1+ tasks:

1. Confirm API is up:
   - `GET /api/health`
2. Run smoke tests:
   - `npm run smoke`
3. Create DB backup:
   - `npm run db:backup`

Backup/restore prerequisite:
- Install MongoDB Database Tools so `mongodump` and `mongorestore` are available, or set
   `MONGODUMP_PATH` and `MONGORESTORE_PATH` environment variables to executable paths.

If anything breaks during development:

1. Stop backend process.
2. Revert to last stable code branch/commit.
3. Restore backup:
   - `npm run db:restore`
4. Re-run smoke tests:
   - `npm run smoke`
5. Continue only when smoke test passes.

Useful smoke env overrides (in `.env`):
- `SMOKE_BASE_URL`
- `SMOKE_USERNAME`
- `SMOKE_PASSWORD`
- `SMOKE_PIN`

## 8) Phase 6 Product Enrichment

Product schema now includes optional fields:
- `brand`
- `color`
- `size`
- `supplierName`

Run one-time safe migration for old product documents:
- `npm run migrate:products:phase6`

## 9) Phase 8 Stabilization

Phase 8 adds hardening around backend-first behavior and contract checks:

- Inventory context now refreshes backend data on authenticated user changes.
- Smoke test now validates admin user list endpoint contract:
   - `GET /api/auth/users`

Run Phase 8 smoke validation:
- `npm run smoke`
