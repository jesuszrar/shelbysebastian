-- SUPABASE INITIALIZATION SCRIPT
-- Ejecuta estos comandos en Supabase SQL Editor para configurar la base de datos
-- 1. Tablas base (profiles, products, orders)
-- 2. Trigger para sincronizar auth con profiles
-- 3. RLS (Row Level Security)
-- 4. Marca el usuario admin por cedula

-- =============================================
-- 1. CREAR TABLA profiles (sincronizada con auth.users)
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  cedula TEXT UNIQUE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- 2. CREAR TABLA products
-- =============================================
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  image TEXT,
  description TEXT,
  specs JSONB DEFAULT '[]'::jsonb,
  stock INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- 3. CREAR TABLA orders
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  items JSONB NOT NULL,
  total INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- 4. CREAR TRIGGER para sincronizar auth -> profiles
-- =============================================
-- Cédula con acceso administrador permanente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    UPDATE public.profiles
    SET is_admin = TRUE
    WHERE cedula = '1108758522';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_email_by_cedula(lookup_cedula TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE cedula = lookup_cedula
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_email_by_cedula(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_cedula(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_profile(
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  user_cedula TEXT,
  user_is_admin BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, cedula, is_admin)
  VALUES (user_id, user_email, user_name, user_cedula, user_is_admin)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = EXCLUDED.name,
      cedula = EXCLUDED.cedula,
      is_admin = EXCLUDED.is_admin;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, cedula, is_admin)
  VALUES (
    NEW.id,
    NEW.email,
    (NEW.user_metadata->>'name')::TEXT,
    (NEW.user_metadata->>'cedula')::TEXT,
    COALESCE((NEW.user_metadata->>'cedula')::TEXT = '1108758522', FALSE)
  )
  ON CONFLICT (id) DO UPDATE
  SET email = NEW.email,
      name = (NEW.user_metadata->>'name')::TEXT,
      cedula = (NEW.user_metadata->>'cedula')::TEXT,
      is_admin = COALESCE((NEW.user_metadata->>'cedula')::TEXT = '1108758522', FALSE);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- 5. HABILITAR RLS (Row Level Security)
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 6. POLÍTICAS RLS para profiles
-- =============================================
CREATE POLICY "Profiles are viewable by authenticated users" 
ON profiles FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own profile" 
ON profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can update any profile" 
ON profiles FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  )
);

-- =============================================
-- 7. POLÍTICAS RLS para products (lectura pública, edición solo admin)
-- =============================================
CREATE POLICY "Products are viewable by anyone" 
ON products FOR SELECT
USING (TRUE);

CREATE POLICY "Admins can insert products" 
ON products FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  )
);

CREATE POLICY "Admins can update products" 
ON products FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  )
);

CREATE POLICY "Admins can delete products" 
ON products FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  )
);

-- =============================================
-- 8. POLÍTICAS RLS para orders (solo admin puede listar, usuarios ven sus órdenes)
-- =============================================
CREATE POLICY "Users can see their own orders" 
ON orders FOR SELECT
USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE POLICY "Admins can see all orders" 
ON orders FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  )
);

-- =============================================
-- 9. MARCAR USUARIO COMO ADMIN (cedula: 1108758522)
-- =============================================
UPDATE profiles
SET is_admin = TRUE
WHERE cedula = '1108758522';

-- Verifica que se haya actualizado:
SELECT id, email, name, cedula, is_admin FROM profiles WHERE cedula = '1108758522';

-- =============================================
-- 10. CREAR ÍNDICES para mejor performance
-- =============================================
CREATE INDEX idx_profiles_cedula ON profiles(cedula);
CREATE INDEX idx_profiles_is_admin ON profiles(is_admin);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_products_category ON products(category);

-- =============================================
-- NOTAS FINALES
-- =============================================
-- Bucket product-images:
-- 1. Ve a Supabase > Storage > New Bucket
-- 2. Nombre: product-images
-- 3. Marca como "Public"
-- 4. (Opcional) Configura RLS si prefieres control granular
--
-- Para crear el bucket con SQL (si tu plan lo permite):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true);
--
-- Después puedes usar en la UI:
-- supabase.storage.from('product-images').upload(path, file)
-- supabase.storage.from('product-images').getPublicUrl(path)
