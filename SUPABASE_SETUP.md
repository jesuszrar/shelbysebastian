Admin panel setup (Supabase)

This project uses Supabase for auth and functions. The Admin panel expects the following tables and fields:

1) profiles (sync with auth)
- id: uuid (primary key, same as auth user's id)
- email: text
- name: text
- cedula: text
- is_admin: boolean (default false)

2) products
- id: text (primary key)
- name: text
- category: text
- price: integer
- image: text (url)
- description: text
- specs: jsonb
- created_at: timestamp with time zone default now()

 - stock: integer

Storage:
- Create a public bucket named `product-images` for product pictures (or configure RLS accordingly).

Notes about images:
- Use `supabase.storage.from('product-images').upload(path, file)` to upload and `getPublicUrl` to obtain a URL.
- Make sure the bucket is public or configure signed URLs via Edge Functions for secure access.
3) orders
- id: text (primary key)
- items: jsonb
- total: integer
- status: text
- created_at: timestamp with time zone default now()

Recommended steps:
- Create the tables above in Supabase SQL editor.
- Create a trigger on `auth` to populate `profiles` on user sign up (Supabase docs: "Create a profiles table").
- When you insert/update `profiles.is_admin`, the frontend reads it from `profiles` and AuthContext maps `session.user.user_metadata.is_admin` if available.
- Secure access: use Row Level Security and policies so only admin users can modify `products` and `orders` via the API, or use Supabase Edge Functions for admin-only operations with service_role key.

Notes:
- Listing all auth users via the client requires admin privileges — we read from `profiles` instead.
- After creating tables, set environment variables in Netlify: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` and `MERCADOPAGO_ACCESS_TOKEN_CLIENT`.

If you want, I can generate SQL statements to create these tables and a trigger for `profiles`."}