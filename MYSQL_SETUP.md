# Shelby MySQL Setup

This project is migrating away from Supabase to a MySQL backend with Prisma and Express.

## What you need

- MySQL 8+ database
- Node.js 18+
- A backend `.env` file with `DATABASE_URL`, `JWT_SECRET`, `PORT`, and `CORS_ORIGIN`
- A frontend `.env` file with `VITE_API_URL`

## Backend setup

1. Open a terminal in the project root.
2. Enter the backend folder:

```powershell
Set-Location .\backend
```

3. Install backend dependencies:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
```

4. Copy `backend/.env.example` to `backend/.env` and fill in the values.
5. Generate Prisma client:

```powershell
& "C:\Program Files\nodejs\npx.cmd" prisma generate
```

6. Create and apply the first migration:

```powershell
& "C:\Program Files\nodejs\npx.cmd" prisma migrate dev --name init
```

7. Start the backend server:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run dev
```

## Frontend setup

1. Copy `.env.example` to `.env`.
2. Set `VITE_API_URL` to the backend URL, for example `http://localhost:3001`.
3. In a second terminal, return to the project root and start the frontend:

```powershell
Set-Location ..
& "C:\Program Files\nodejs\npm.cmd" run dev
```

## Suggested local startup order

1. Start MySQL and confirm the database exists.
2. Run the backend migration commands above.
3. Start the backend on port 3001.
4. Start the frontend on the Vite port.
5. Log in, register, and verify that products and orders load from the backend.

## Notes

- The backend now handles auth, products, orders, cédula lookup, image uploads, and Mercado Pago preference creation.
- The old Supabase SQL files are kept only as historical reference during the transition.
