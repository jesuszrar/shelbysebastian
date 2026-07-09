# Shelby MySQL Backend

This folder is the new backend for the app after moving away from Supabase.

## What it covers

- Auth with email/password and cédula lookup
- Products CRUD
- Orders CRUD
- Cédula/email lookup table
- Mercado Pago preference proxy
- File uploads served from `/uploads`

## Next steps

1. Create a MySQL database.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, and either `MERCADOPAGO_ACCESS_TOKEN_CLIENT` or `MERCADOPAGO_ACCESS_TOKEN`. If you want invoice emails, also set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.
	- In `CORS_ORIGIN`, add the exact URL of your live frontend, for example `https://tudominio.com` or `https://www.tudominio.com`.
3. Run these commands from PowerShell inside `backend/`:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npx.cmd" prisma generate
& "C:\Program Files\nodejs\npx.cmd" prisma migrate dev --name init
& "C:\Program Files\nodejs\npm.cmd" run dev
```

4. Set `VITE_API_URL` in the frontend `.env` to the backend URL, for example `http://localhost:3001`.
