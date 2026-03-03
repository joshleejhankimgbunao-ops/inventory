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

Sample dev accounts after seeding:

- `owner / Owner123!` (superadmin)
- `admin1 / Admin123!` (admin)
- `cashier1 / Cashier123!` (cashier)

## 3) Health Check

```bash
GET /api/health
```

## 4) Initial Routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (requires Bearer token)
- `GET /api/products` (requires token)
- `POST /api/products` (superadmin/admin only)
- `PATCH /api/products/:id` (superadmin/admin only)
- `GET /api/sales` (superadmin/admin only)
- `POST /api/sales` (superadmin/admin/cashier)

## 5) Notes

- Roles are aligned with frontend roles: `superadmin`, `admin`, `cashier`.
- This is a starter scaffold; add validation, transactions, and audit logging next.
- Teammate handoff doc is in `server/HANDOFF.md`.
