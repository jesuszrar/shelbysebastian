import { useEffect, useMemo, useState } from "react";
import { Footer } from "@/components/shelby/Footer";
import { Navbar } from "@/components/shelby/Navbar";
import { Button } from "@/components/ui/button";
import { useProductsCatalog } from "@/context/ProductsContext";
import { supabase } from "@/integrations/api/client";
import { formatCOP, products as defaultProducts, type Product } from "@/data/products";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  ImagePlus,
  Package,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

const ADMIN_EMAIL_STATUSES = new Set(["paid", "approved", "completed"]);
const LOW_STOCK_LIMIT = 3;
const ORDER_STATUS_OPTIONS = ["pending", "paid", "approved", "shipped", "delivered", "cancelled", "failed"] as const;

type ProductRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string | null;
  stock: number | null;
  description: string | null;
  specs: string[] | null;
  created_at?: string;
};

type OrderRow = {
  id: string;
  total: number;
  status: string;
  createdAt?: string;
  created_at?: string;
  userId?: string | null;
  user_id?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerCity?: string | null;
  customerAddress?: string | null;
  paymentMethod?: string | null;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  cedula?: string;
  is_admin?: boolean;
};

type ProductForm = {
  name: string;
  category: string;
  price: string;
  stock: string;
  description: string;
  specsText: string;
  image: string;
};

type MonthlyStats = {
  month: string;
  income: number;
  orders: number;
};

const toProductRow = (product: Product): ProductRow => ({
  id: product.id,
  name: product.name,
  category: product.category,
  price: product.price,
  image: product.image,
  stock: null,
  description: product.description,
  specs: product.specs,
});

const emptyProductForm = (): ProductForm => ({
  name: "",
  category: "Adhesivas",
  price: "0",
  stock: "0",
  description: "",
  specsText: "",
  image: "",
});

const parseSpecs = (specsText: string) =>
  specsText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const isRevenueStatus = (status: string) => ADMIN_EMAIL_STATUSES.has(status.toLowerCase());

const monthLabel = (dateString: string) =>
  new Intl.DateTimeFormat("es-CO", {
    month: "short",
    year: "2-digit",
  }).format(new Date(dateString));

const downloadTextFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const escapeCsvValue = (value: string | number | null | undefined) => {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
};

const buildCsv = (headers: string[], rows: Array<Array<string | number | null | undefined>>) =>
  [headers.map(escapeCsvValue).join(","), ...rows.map((row) => row.map(escapeCsvValue).join(","))].join("\n");

const Admin = () => {
  const [tab, setTab] = useState<"overview" | "products" | "orders" | "users">("overview");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-32 pb-20">
        <div className="container-shelby space-y-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="text-primary text-xs uppercase tracking-[0.3em] font-semibold">Panel de control</span>
              <h1 className="font-display text-3xl sm:text-4xl text-secondary mt-2">Administra catálogo, ventas y usuarios</h1>
              <p className="text-muted-foreground mt-2 max-w-2xl">
                Desde aquí puedes cambiar imágenes, precios, stock, descripciones, revisar ingresos, manejar pedidos y otorgar acceso admin a otros usuarios.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-full px-4 py-2 w-fit">
              <Sparkles className="h-4 w-4 text-primary" /> Recomendado: mantener bajo stock visible y actualizar pedidos cada día
            </div>
          </div>

          <AdminOverview />

          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={BarChart3} label="Resumen" />
            <TabButton active={tab === "products"} onClick={() => setTab("products")} icon={Package} label="Productos" />
            <TabButton active={tab === "orders"} onClick={() => setTab("orders")} icon={ShoppingCart} label="Ventas" />
            <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={Users} label="Usuarios" />
          </div>

          {tab === "overview" && <OverviewPanel />}
          {tab === "products" && <ProductsAdmin />}
          {tab === "orders" && <OrdersAdmin />}
          {tab === "users" && <UsersAdmin />}
        </div>
      </main>
      <Footer />
    </div>
  );
};

function AdminOverview() {
  return <OverviewPanel compact />;
}

function OverviewPanel({ compact = false }: { compact?: boolean }) {
  const { rows: productRows, products: liveProducts, loading: productsLoading } = useProductsCatalog();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [ordersResult, usersResult] = await Promise.all([
        supabase.from<OrderRow>("orders").select("id,total,status,createdAt,created_at,userId,user_id,customerName,customerEmail,customerPhone,customerCity,customerAddress,paymentMethod").order("createdAt", { ascending: false }),
        supabase.from<UserRow>("profiles").select("id,name,email,cedula,is_admin"),
      ]);

      if (ordersResult.error) console.error(ordersResult.error);
      if (usersResult.error) console.error(usersResult.error);

      setOrders((ordersResult.data as OrderRow[]) || []);
      setUsers((usersResult.data as UserRow[]) || []);
      setLoading(false);
    };

    void load();
  }, []);

  const productCatalog = productRows.length ? productRows : liveProducts.map(toProductRow);
  const lowStock = productCatalog.filter((product) => Number(product.stock ?? 0) <= LOW_STOCK_LIMIT).length;
  const revenue = orders.filter((order) => isRevenueStatus(order.status)).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pending = orders.filter((order) => order.status === "pending").length;
  const adminCount = users.filter((user) => user.is_admin).length;
  const monthlyStats = useMemo(() => {
    const grouped = new Map<string, MonthlyStats>();

    orders
      .filter((order) => isRevenueStatus(order.status))
      .forEach((order) => {
        const month = monthLabel(order.created_at);
        const current = grouped.get(month) || { month, income: 0, orders: 0 };
        current.income += Number(order.total || 0);
        current.orders += 1;
        grouped.set(month, current);
      });

    return Array.from(grouped.values()).slice(-6);
  }, [orders]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Cargando resumen...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Package} label="Productos" value={String(productCatalog.length)} help={productsLoading ? "Sincronizando catálogo" : "En catálogo"} />
        <StatCard icon={AlertTriangle} label="Stock bajo" value={String(lowStock)} help="Productos por reponer" />
        <StatCard icon={ShoppingCart} label="Pedidos" value={String(orders.length)} help={pending ? `${pending} pendientes` : "Sin pendientes"} />
        <StatCard icon={ShieldCheck} label="Admins" value={String(adminCount)} help="Usuarios con acceso elevado" />
      </div>

      {!compact && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="bg-card border border-border rounded-3xl p-6 shadow-soft">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-2xl text-secondary">Resumen de ventas</h2>
                <p className="text-sm text-muted-foreground">Últimos meses con ingresos confirmados.</p>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Ingresos</div>
                <div className="font-display text-3xl text-primary mt-1">{formatCOP(revenue)}</div>
              </div>
            </div>
            <div className="mt-5 h-[280px]">
              {monthlyStats.length === 0 ? (
                <div className="text-sm text-secondary/80">Todavía no hay datos para mostrar.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyStats}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => (typeof value === "number" ? formatCOP(value) : value)} />
                    <Legend />
                    <Bar dataKey="income" name="Ingresos" fill="#d97706" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="orders" name="Pedidos" fill="#1d4ed8" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-3xl p-6 shadow-soft">
            <h2 className="font-display text-2xl text-secondary">Accesos rápidos</h2>
            <div className="mt-4 grid gap-3">
              <QuickAction title="Productos" description="Editar catálogo, stock e imágenes" icon={Package} />
              <QuickAction title="Usuarios" description="Dar admin por cédula o quitar permisos" icon={Users} />
              <QuickAction title="Ventas" description="Revisar pedidos y exportar datos" icon={BarChart3} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductsAdmin() {
  const { rows, products, loading, refreshProducts } = useProductsCatalog();
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyProductForm());
  const catalogRows = rows.length ? rows : products.map(toProductRow);

  const startEdit = (product: ProductRow) => {
    setEditing(product.id);
    setForm({
      name: product.name,
      category: product.category,
      price: String(product.price ?? 0),
      stock: String(product.stock ?? 0),
      description: product.description || "",
      specsText: (product.specs || []).join(", "),
      image: product.image || "",
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(emptyProductForm());
  };

  const uploadImage = async (file: File) => {
    if (!editing) return;
    const extension = file.name.split(".").pop() || "jpg";
    const path = `products/${editing}-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
    if (uploadError) {
      console.error('Image upload error:', uploadError);
      const detail = uploadError.message || JSON.stringify(uploadError);
      toast.error(detail.length > 240 ? detail.slice(0, 240) + '…' : detail);
      throw uploadError;
    }
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    setForm((current) => ({ ...current, image: data.publicUrl }));
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      price: Math.max(0, Number(form.price) || 0),
      stock: Math.max(0, Number(form.stock) || 0),
      description: form.description.trim(),
      specs: parseSpecs(form.specsText),
      image: form.image.trim() || null,
    };

    const { error } = await supabase.from("products").upsert({ id: editing, ...payload }, { onConflict: "id" });
    if (error) {
      console.error("Backend upsert error:", error);
      const detailed = (error && (error.message || JSON.stringify(error))) || "No se pudo guardar el producto";
      // Detect missing table and give actionable guidance
      if (typeof detailed === "string" && (detailed.includes("Could not find the table") || detailed.includes("relation \"products\" does not exist") || detailed.includes("table \"public.products\""))) {
        toast.error("La tabla 'products' no existe o el backend no está conectado. Revisa MYSQL_SETUP.md y ejecuta la migración de Prisma en el backend.");
        console.error("Backend table missing. Check MYSQL_SETUP.md and run the Prisma migration in the backend.");
      } else {
        const short = typeof detailed === "string" && detailed.length > 240 ? detailed.slice(0, 240) + "…" : detailed;
        toast.error(short);
      }
      setSaving(false);
      return;
    }

    await refreshProducts();
    cancelEdit();
    setSaving(false);
  };

  const createNew = async () => {
    const newId = crypto.randomUUID();
    const name = prompt("Nombre del producto");
    if (!name) return;

    const { error } = await supabase.from("products").insert([
      {
        id: newId,
        name,
        category: "Adhesivas",
        price: 0,
        stock: 0,
        description: "",
        image: null,
        specs: [],
      },
    ]);

    if (error) {
      console.error(error);
      const detailed = (error && (error.message || JSON.stringify(error))) || "No se pudo crear el producto";
      if (typeof detailed === "string" && (detailed.includes("Could not find the table") || detailed.includes("relation \"products\" does not exist") || detailed.includes("table \"public.products\""))) {
        toast.error("La tabla 'products' no existe o el backend no está conectado. Revisa MYSQL_SETUP.md y ejecuta la migración de Prisma en el backend.");
        console.error("Backend table missing. Check MYSQL_SETUP.md and run the Prisma migration in the backend.");
      } else {
        toast.error("No se pudo crear el producto");
      }
      return;
    }

    await refreshProducts();
    startEdit({
      id: newId,
      name,
      category: "Adhesivas",
      price: 0,
      image: null,
      stock: 0,
      description: "",
      specs: [],
    });
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminar producto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      console.error(error);
      const detailed = (error && (error.message || JSON.stringify(error))) || "No se pudo eliminar el producto";
      if (typeof detailed === "string" && (detailed.includes("Could not find the table") || detailed.includes("relation \"products\" does not exist") || detailed.includes("table \"public.products\""))) {
        toast.error("La tabla 'products' no existe o el backend no está conectado. Revisa MYSQL_SETUP.md y ejecuta la migración de Prisma en el backend.");
        console.error("Backend table missing. Check MYSQL_SETUP.md and run the Prisma migration in the backend.");
      } else {
        toast.error("No se pudo eliminar el producto");
      }
      return;
    }
    await refreshProducts();
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl text-secondary">Productos</h2>
          <p className="text-sm text-muted-foreground">Edita imágenes, precios, stock, descripciones y especificaciones.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={refreshProducts} variant="outline" className="gap-2">
            <RefreshCcw className="h-4 w-4" /> Refrescar
          </Button>
          <Button onClick={createNew} variant="secondary" className="gap-2">
            <Plus className="h-4 w-4" /> Nuevo producto
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Cargando productos...</div>
      ) : (
        <div className="grid gap-4">
          {catalogRows.map((product) => (
            <div key={product.id} className="bg-card border border-border rounded-3xl p-4 shadow-soft">
              <div className="flex flex-col lg:flex-row gap-4 lg:items-center">
                <img
                  src={product.image || "/placeholder.png"}
                  alt={product.name}
                  className="h-24 w-24 rounded-2xl object-cover bg-muted flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-xl text-secondary truncate">{product.name}</h3>
                    {Number(product.stock ?? 0) <= LOW_STOCK_LIMIT && (
                      <span className="text-xs font-semibold text-destructive bg-destructive/10 px-2 py-1 rounded-full">Stock crítico</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {product.category} · {formatCOP(product.price)} · Stock: {product.stock ?? 0}
                  </div>
                  {product.description && <p className="text-sm text-secondary/80 mt-2 line-clamp-2">{product.description}</p>}
                  {product.specs?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {product.specs.map((spec) => (
                        <span key={spec} className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary border border-primary/20 font-medium">
                          {spec}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button variant="outline" onClick={() => startEdit(product)} className="gap-2">
                    <ImagePlus className="h-4 w-4" /> Editar
                  </Button>
                  <Button variant="destructive" onClick={() => remove(product.id)} className="gap-2">
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </Button>
                </div>
              </div>

              {editing === product.id && (
                <div className="mt-4 bg-background border border-border rounded-2xl p-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    <Field label="Nombre" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
                    <Field label="Categoría" value={form.category} onChange={(value) => setForm((current) => ({ ...current, category: value }))} />
                    <Field label="Precio / costo" type="number" value={form.price} onChange={(value) => setForm((current) => ({ ...current, price: value }))} />
                    <Field label="Stock" type="number" value={form.stock} onChange={(value) => setForm((current) => ({ ...current, stock: value }))} />
                    <div className="md:col-span-2">
                      <Field
                        label="Imagen URL"
                        value={form.image}
                        onChange={(value) => setForm((current) => ({ ...current, image: value }))}
                        placeholder="Pega un enlace o sube un archivo"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm font-medium text-secondary block mb-1.5">Subir imagen</label>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-background hover:bg-accent cursor-pointer">
                          <Upload className="h-4 w-4" /> Subir archivo
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              try {
                                await uploadImage(file);
                              } catch (error) {
                                console.error(error);
                              }
                            }}
                          />
                        </label>
                        {form.image && <span className="text-xs text-muted-foreground break-all">{form.image}</span>}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm font-medium text-secondary block mb-1.5">Descripción</label>
                      <textarea
                        value={form.description}
                        onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                        rows={4}
                        className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth resize-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Field
                        label="Especificaciones"
                        value={form.specsText}
                        onChange={(value) => setForm((current) => ({ ...current, specsText: value }))}
                        placeholder="Bluetooth, USB-C, batería recargable"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button onClick={save} disabled={saving} variant="secondary" className="gap-2">
                      <Sparkles className="h-4 w-4" /> {saving ? "Guardando..." : "Guardar cambios"}
                    </Button>
                    <Button variant="outline" onClick={cancelEdit}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function OrdersAdmin() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from<OrderRow>("orders")
      .select("id,total,status,created_at,user_id")
      .order("created_at", { ascending: false });
    if (error) console.error(error);
    setRows((data as OrderRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const summary = useMemo(() => {
    const paid = rows.filter((order) => isRevenueStatus(order.status));
    const pending = rows.filter((order) => order.status === "pending");
    return {
      total: rows.length,
      income: paid.reduce((sum, order) => sum + Number(order.total || 0), 0),
      pending: pending.length,
      average: rows.length ? rows.reduce((sum, order) => sum + Number(order.total || 0), 0) / rows.length : 0,
    };
  }, [rows]);

  const updateStatus = async (id: string, status: string) => {
    setSavingId(id);
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) {
      console.error(error);
      setSavingId(null);
      return;
    }
    setRows((current) => current.map((order) => (order.id === id ? { ...order, status } : order)));
    setSavingId(null);
  };

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ShoppingCart} label="Pedidos" value={String(summary.total)} help="Pedidos registrados" />
        <StatCard icon={BarChart3} label="Ingresos" value={formatCOP(summary.income)} help="Solo pedidos cobrados" />
        <StatCard icon={RefreshCcw} label="Pendientes" value={String(summary.pending)} help="Pedidos por revisar" />
        <StatCard icon={Sparkles} label="Promedio" value={formatCOP(summary.average)} help="Ticket promedio" />
      </div>

      <div className="bg-card border border-border rounded-3xl p-6 shadow-soft">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-2xl text-secondary">Ventas</h2>
            <p className="text-sm text-muted-foreground">Cambia el estado de cada pedido y revisa los ingresos confirmados.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => downloadTextFile(`ventas-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(["ID", "Total", "Estado", "Correo", "Método", "Fecha", "Usuario"], rows.map((order) => [order.id, order.total, order.status, order.customerEmail || "", order.paymentMethod || "", order.createdAt || order.created_at || "", order.userId || order.user_id || ""])), "text/csv;charset=utf-8;")}
              className="gap-2"
            >
              CSV ventas
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadTextFile(`ventas-${new Date().toISOString().slice(0, 10)}.xls`, `\n                <html><head><meta charset=\"utf-8\" /></head><body><table border=\"1\"><thead><tr><th>ID</th><th>Total</th><th>Estado</th><th>Correo</th><th>Método</th><th>Fecha</th><th>Usuario</th></tr></thead><tbody>${rows
                .map((order) => `<tr><td>${order.id}</td><td>${order.total}</td><td>${order.status}</td><td>${order.customerEmail || ""}</td><td>${order.paymentMethod || ""}</td><td>${order.createdAt || order.created_at || ""}</td><td>${order.userId || order.user_id || ""}</td></tr>`)
                .join("")}</tbody></table></body></html>`, "application/vnd.ms-excel;charset=utf-8;")}
              className="gap-2"
            >
              Excel ventas
            </Button>
            <Button onClick={fetchOrders} variant="outline" className="gap-2">
              <RefreshCcw className="h-4 w-4" /> Refrescar
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">Cargando pedidos...</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-secondary/80">Aún no hay ventas registradas.</div>
          ) : (
            rows.map((order) => (
              <div key={order.id} className="rounded-2xl border border-border p-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="font-semibold text-secondary">Orden {order.id}</div>
                  <div className="text-xs text-muted-foreground">{new Date(order.createdAt || order.created_at || Date.now()).toLocaleString()} · Usuario: {order.userId || order.user_id || "invitado"}</div>
                  <div className="text-xs text-muted-foreground mt-1">{order.customerName || "Sin nombre"} · {order.customerEmail || "sin correo"} · {order.paymentMethod || "sin método"}</div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <select
                    value={order.status}
                    onChange={(event) => updateStatus(order.id, event.target.value)}
                    className="px-3 py-2 rounded-xl border border-border bg-background text-sm"
                  >
                    {ORDER_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <div className="font-display text-xl text-primary min-w-32 text-right">{formatCOP(order.total)}</div>
                  {savingId === order.id ? <span className="text-xs text-muted-foreground">Guardando...</span> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function UsersAdmin() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [cedulaToPromote, setCedulaToPromote] = useState("");
  const [promoting, setPromoting] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.from<UserRow>("profiles").select("id,name,email,cedula,is_admin");
    if (error) console.error(error);
    setRows((data as UserRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = useMemo(
    () =>
      rows.filter((user) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return true;
        return [user.name, user.email, user.cedula || ""].some((value) => value.toLowerCase().includes(needle));
      }),
    [rows, query],
  );

  const toggleAdmin = async (id: string, current?: boolean) => {
    setSavingId(id);
    try {
      const { error } = await supabase.from("profiles").update({ is_admin: !current }).eq("id", id);
      if (error) {
        console.error(error);
        const detail = error.message || JSON.stringify(error);
        toast.error(detail.length > 180 ? detail.slice(0, 180) + "…" : detail);
        return;
      }
      setRows((currentRows) => currentRows.map((user) => (user.id === id ? { ...user, is_admin: !current } : user)));
      toast.success(current ? "Se quitó el acceso admin" : "Se otorgó acceso admin");
      await fetchUsers();
    } finally {
      setSavingId(null);
    }
  };

  const grantAdminByCedula = async () => {
    const cedula = cedulaToPromote.trim();
    if (!cedula) {
      toast.error("Ingresa una cédula");
      return;
    }

    setPromoting(true);
    const { data: profile, error } = await supabase
      .from<UserRow>("profiles")
      .select("id,name,email,cedula,is_admin")
      .eq("cedula", cedula)
      .maybeSingle();

    if (error) {
      console.error(error);
      toast.error("No se pudo buscar la cédula");
      setPromoting(false);
      return;
    }

    if (!profile) {
      toast.error("No existe un perfil con esa cédula");
      setPromoting(false);
      return;
    }

    const { error: updateError } = await supabase.from("profiles").update({ is_admin: true }).eq("id", profile.id);
    if (updateError) {
      console.error(updateError);
      const detail = updateError.message || JSON.stringify(updateError);
      toast.error(detail.length > 180 ? detail.slice(0, 180) + "…" : detail);
      setPromoting(false);
      return;
    }

    setRows((currentRows) => currentRows.map((user) => (user.id === profile.id ? { ...user, is_admin: true } : user)));
    setCedulaToPromote("");
    toast.success(`Ahora ${profile.name || cedula} tiene acceso admin`);
    await fetchUsers();
    setPromoting(false);
  };

  const adminCount = rows.filter((user) => user.is_admin).length;

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard icon={Users} label="Usuarios" value={String(rows.length)} help="Usuarios cargados" />
        <StatCard icon={ShieldCheck} label="Administradores" value={String(adminCount)} help="Acceso elevado" />
        <StatCard icon={Search} label="Filtrados" value={String(filteredUsers.length)} help="Según búsqueda" />
      </div>

      <div className="bg-card border border-border rounded-3xl p-6 shadow-soft">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-2xl text-secondary">Usuarios</h2>
            <p className="text-sm text-muted-foreground">Busca por nombre, correo o cédula y asigna acceso admin a otros usuarios confiables.</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={cedulaToPromote}
                onChange={(event) => setCedulaToPromote(event.target.value)}
                placeholder="Cédula para dar admin"
                className="px-3 py-2 rounded-xl border border-border bg-background min-w-64"
              />
              <Button type="button" onClick={grantAdminByCedula} disabled={promoting} variant="secondary" className="gap-2">
                <ShieldCheck className="h-4 w-4" /> {promoting ? "Otorgando..." : "Dar admin por cédula"}
              </Button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadTextFile(`usuarios-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(["ID", "Nombre", "Email", "Cedula", "Admin"], rows.map((user) => [user.id, user.name, user.email, user.cedula || "", user.is_admin ? "SI" : "NO"])), "text/csv;charset=utf-8;")}
              className="gap-2"
            >
              CSV usuarios
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadTextFile(`usuarios-${new Date().toISOString().slice(0, 10)}.xls`, `\n                <html><head><meta charset=\"utf-8\" /></head><body><table border=\"1\"><thead><tr><th>ID</th><th>Nombre</th><th>Email</th><th>Cedula</th><th>Admin</th></tr></thead><tbody>${rows
                .map((user) => `<tr><td>${user.id}</td><td>${user.name}</td><td>${user.email}</td><td>${user.cedula || ""}</td><td>${user.is_admin ? "SI" : "NO"}</td></tr>`)
                .join("")}</tbody></table></body></html>`, "application/vnd.ms-excel;charset=utf-8;")}
              className="gap-2"
            >
              Excel usuarios
            </Button>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar usuario"
                className="pl-10 pr-4 py-2 rounded-xl border border-border bg-background min-w-64"
              />
            </div>
            <Button type="button" onClick={fetchUsers} variant="outline" className="gap-2">
              <RefreshCcw className="h-4 w-4" /> Refrescar
            </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">Cargando usuarios...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-sm text-secondary/80">No se encontraron usuarios con ese filtro.</div>
          ) : (
            filteredUsers.map((user) => (
              <div key={user.id} className="rounded-2xl border border-border p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="font-semibold text-secondary flex flex-wrap items-center gap-2">
                    {user.name || "Sin nombre"}
                    {user.is_admin && <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-1 rounded-full">Admin</span>}
                    {user.cedula && <span className="text-xs text-muted-foreground">· {user.cedula}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </div>
                <Button onClick={() => toggleAdmin(user.id, user.is_admin)} disabled={savingId === user.id} variant="secondary" className="gap-2">
                  <ShieldCheck className="h-4 w-4" /> {user.is_admin ? "Quitar admin" : "Dar admin"}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-smooth ${active ? "bg-primary text-primary-foreground border-primary shadow-soft" : "bg-card text-secondary border-border hover:border-primary/40"}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function StatCard({ icon: Icon, label, value, help }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; help: string }) {
  return (
    <div className="bg-card border border-border rounded-3xl p-5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
          <div className="font-display text-3xl text-secondary mt-2">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{help}</div>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ title, description, icon: Icon }: { title: string; description: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="font-semibold text-secondary">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-secondary block mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth"
      />
    </label>
  );
}

export default Admin;
