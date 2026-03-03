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
- `MONGO_URI=mongodb://127.0.0.1:27017/inventory`
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

### Products
- `GET /api/products` (Bearer token)
- `POST /api/products` (superadmin/admin)
- `PATCH /api/products/:id` (superadmin/admin)

### Sales
- `GET /api/sales` (superadmin/admin)
- `POST /api/sales` (superadmin/admin/cashier)

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
