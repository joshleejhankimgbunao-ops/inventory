# Inventory System

Full-stack inventory and point-of-sale system with:

- Frontend: React + Vite
- Backend: Express + MongoDB
- Auth: JWT with optional PIN challenge

## Workspace Structure

- `src/`: frontend application
- `server/`: backend API and scripts
- `_backend_publish/`: publish/handoff backend variant
- `scripts/`: root helper scripts

## Prerequisites

- Node.js 20+
- npm 10+
- MongoDB (local or Atlas)

## Local Setup

1. Install root dependencies:

```bash
npm install
```

2. Install backend dependencies:

```bash
npm --prefix server install
```

3. Configure backend environment:

```bash
cd server
cp .env.example .env
```

4. Set required values in `server/.env`:

- `MONGO_URI`
- `JWT_SECRET`
- `CLIENT_ORIGIN`

5. Seed and prepare backend users/data:

```bash
npm --prefix server run seed:reset
node server/scripts/createOwner.js
node server/scripts/setOwnerPin.js
```

## Development Commands

Run frontend dev server:

```bash
npm run dev
```

Run backend API:

```bash
npm run dev:server
```

Run backend directly from `server/`:

```bash
npm run dev
```

## Verification Commands

Frontend build only:

```bash
npm run build
```

Backend smoke only (from root):

```bash
npm run smoke:server
```

Backend smoke only (from `server/`):

```bash
npm run smoke
```

Integration auth flow test (from `server/`):

```bash
npm run test:auth-flow
```

Full verification (recommended before merge):

```bash
npm run verify:full
```

## CI

GitHub Actions workflow is defined in `.github/workflows/ci.yml`.

Pipeline checks:

- backend auth integration flow test
- full verification (`npm run verify:full`)

## Troubleshooting

If smoke fails with network error:

1. Ensure backend is running on `http://127.0.0.1:5000`
2. Ensure `SMOKE_BASE_URL` points to the correct server
3. Recreate smoke credentials:

```bash
node server/scripts/createOwner.js
node server/scripts/setOwnerPin.js
```
