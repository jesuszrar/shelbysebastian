import { useEffect, useState } from "react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/data/products";

type ProductRow = { id: string; name: string; category: string; price: number; image: string | null };
type OrderRow = { id: string; total: number; status: string; created_at: string };
type UserRow = { id: string; name: string; email: string; cedula?: string; is_admin?: boolean };

const Admin = () => {
  const [tab, setTab] = useState<"products" | "orders" | "users">("products");
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-32 pb-20">
        <div className="container-shelby">
          <h1 className="font-display text-3xl mb-6">Panel Admin</h1>
          <div className="flex gap-2 mb-6">
            <button onClick={() => setTab("products")} className={`px-4 py-2 rounded ${tab==="products"?"bg-primary text-primary-foreground":"bg-muted"}`}>Productos</button>
            <button onClick={() => setTab("orders")} className={`px-4 py-2 rounded ${tab==="orders"?"bg-primary text-primary-foreground":"bg-muted"}`}>Ventas</button>
            <button onClick={() => setTab("users")} className={`px-4 py-2 rounded ${tab==="users"?"bg-primary text-primary-foreground":"bg-muted"}`}>Usuarios</button>
          </div>
          {tab === "products" && <ProductsAdmin />}
          {tab === "orders" && <OrdersAdmin />}
          {tab === "users" && <UsersAdmin />}
        </div>
      </main>
      <Footer />
    </div>
  );
};

function ProductsAdmin() {
  type ProductFull = { id: string; name: string; category: string; price: number; image: string | null; stock?: number; description?: string; specs?: string[] };
  const [rows, setRows] = useState<ProductFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ProductFull>>({});

  const fetch = async () => {
    setLoading(true);
    const { data, error } = await supabase.from<ProductFull>('products').select('id,name,category,price,image,stock,description,specs').order('created_at', { ascending: false });
    if (error) console.error(error);
    setRows((data as ProductFull[]) || []);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  const startEdit = (p: ProductFull) => { setEditing(p.id); setForm({ ...p, specs: p.specs || [] }); };
  const cancelEdit = () => { setEditing(null); setForm({}); };

  const handleFile = async (file?: File) => {
    if (!file || !editing) return null;
    try {
      const id = editing;
      const ext = file.name.split('.').pop();
      const path = `products/${id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('product-images').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      return data.publicUrl;
    } catch (err) { console.error(err); return null; }
  };

  const save = async () => {
    if (!editing) return;
    const toSave: any = { name: form.name, category: form.category, price: form.price, stock: form.stock, description: form.description };
    if (form.specs) toSave.specs = form.specs;
    // image handled separately
    if (form.image && typeof form.image !== 'string') {
      // image is a File object stored temporarily
    }
    await supabase.from('products').update(toSave).eq('id', editing);
    cancelEdit();
    fetch();
  };

  const del = async (id: string) => { if (!confirm('Eliminar producto?')) return; await supabase.from('products').delete().eq('id', id); fetch(); };

  const createNew = async () => {
    const newId = (crypto as any).randomUUID ? (crypto as any).randomUUID() : `prod-${Date.now()}`;
    const name = prompt('Nombre del producto');
    if (!name) return;
    await supabase.from('products').insert([{ id: newId, name, price: 0, category: 'Adhesivas', stock: 0 }]);
    fetch();
    startEdit({ id: newId, name, category: 'Adhesivas', price: 0, image: null, stock: 0, description: '', specs: [] });
  };

  const uploadAndSaveImage = async (file: File) => {
    if (!editing) return;
    const url = await handleFile(file);
    if (url) {
      await supabase.from('products').update({ image: url }).eq('id', editing);
      fetch();
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold">Productos</h2>
        <Button onClick={createNew}>Nuevo producto</Button>
      </div>
      {loading ? <div>Cargando...</div> : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <div key={r.id} className="bg-card p-3 rounded">
              <div className="flex items-start gap-4">
                <img src={r.image || '/placeholder.png'} alt={r.name} className="h-20 w-20 rounded object-cover bg-muted flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-lg">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.category} · {formatCOP(r.price)} · Stock: {r.stock ?? 0}</div>
                  <div className="mt-2 text-sm text-secondary">{r.description}</div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => startEdit(r)}>Editar</Button>
                    <Button variant="destructive" onClick={() => del(r.id)}>Eliminar</Button>
                  </div>
                </div>
              </div>
              {editing === r.id && (
                <div className="mt-4 bg-background border border-border p-4 rounded">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input className="px-3 py-2 rounded border" value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nombre" />
                    <input className="px-3 py-2 rounded border" value={form.category || ''} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Categoría" />
                    <input type="number" className="px-3 py-2 rounded border" value={String(form.price ?? '')} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} placeholder="Precio" />
                    <input type="number" className="px-3 py-2 rounded border" value={String(form.stock ?? '')} onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value) }))} placeholder="Stock" />
                    <textarea className="col-span-2 px-3 py-2 rounded border" value={form.description || ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Descripción" />
                    <input className="col-span-2 px-3 py-2 rounded border" value={(form.specs || []).join(', ')} onChange={(e) => setForm((f) => ({ ...f, specs: e.target.value.split(',').map(s => s.trim()) }))} placeholder="Specs (separadas por coma)" />
                    <div className="col-span-2 flex items-center gap-3">
                      <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) await uploadAndSaveImage(file); }} />
                      <Button onClick={save}>Guardar cambios</Button>
                      <Button variant="ghost" onClick={cancelEdit}>Cancelar</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrdersAdmin() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { (async () => { setLoading(true); const { data, error } = await supabase.from<OrderRow>('orders').select('id,total,status,created_at').order('created_at', { ascending: false }); if (error) console.error(error); setRows((data as OrderRow[]) || []); setLoading(false); })(); }, []);
  return (
    <div>
      <h2 className="font-semibold mb-3">Ventas</h2>
      {loading ? <div>Cargando...</div> : (
        <div className="grid gap-2">
          {rows.map((r) => (
            <div key={r.id} className="bg-card p-3 rounded flex items-center justify-between">
              <div>
                <div className="font-semibold">Orden {r.id}</div>
                <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()} · {r.status}</div>
              </div>
              <div className="font-semibold">{formatCOP(r.total)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UsersAdmin() {
  const [rows, setRows] = useState<UserRow[]>([]);
  useEffect(() => { (async () => { const { data, error } = await supabase.from<UserRow>('profiles').select('id,name,email,cedula,is_admin'); if (error) console.error(error); setRows((data as UserRow[]) || []); })(); }, []);

  const toggleAdmin = async (id: string, current?: boolean) => {
    await supabase.from('profiles').update({ is_admin: !current }).eq('id', id);
    setRows((prev) => prev.map((p) => p.id === id ? { ...p, is_admin: !current } : p));
  };

  return (
    <div>
      <h2 className="font-semibold mb-3">Usuarios</h2>
      <div className="grid gap-2">
        {rows.map((u) => (
          <div key={u.id} className="bg-card p-3 rounded flex items-center justify-between">
            <div>
              <div className="font-semibold">{u.name} {u.cedula && <span className="text-xs text-muted-foreground">· {u.cedula}</span>}</div>
              <div className="text-xs text-muted-foreground">{u.email}</div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => toggleAdmin(u.id, u.is_admin)}>{u.is_admin ? 'Quitar admin' : 'Dar admin'}</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Admin;
