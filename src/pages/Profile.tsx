import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock11, FileSearch, LogOut, MapPin, Mail, Phone, Sparkles } from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { fetchData, invokeFunction } from "@/integrations/api/client";
import { formatCOP } from "@/lib/format";
import { SHELBY_WHATSAPP_URL } from "@/lib/contact";

const parseTimestamp = (value?: string | null) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatOrderDate = (value?: string | null) => {
  const date = parseTimestamp(value);
  return date ? date.toLocaleDateString("es-CO") : "-";
};

const Profile = () => {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<{ message: string; discount?: string } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        const { data, error } = await fetchData<Array<Record<string, unknown>>>("orders", {
          filters: JSON.stringify([{ column: "userId", value: user.id }]),
          orderBy: "createdAt",
          ascending: false,
        });
        if (error) {
          console.error(error);
          setOrders([]);
        } else {
          setOrders(data || []);
        }
      } catch (error) {
        console.error(error);
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user]);

  const recentOrders = useMemo(() => {
    return [...orders]
      .sort((a, b) => {
        const aDate = parseTimestamp(String(a.createdAt || a.created_at || ""));
        const bDate = parseTimestamp(String(b.createdAt || b.created_at || ""));
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate.getTime() - aDate.getTime();
      })
      .slice(0, 10);
  }, [orders]);

  const handleApplyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setCouponResult({ message: "Ingresa un código de cupón." });
      return;
    }
    setCouponLoading(true);
    try {
      const { data, error } = await invokeFunction("redeem-coupon", { code, subtotal: 0, shipping: 0 });
      if (error || !data) {
        setCouponResult({ message: error?.message || "Cupón inválido o no encontrado." });
      } else {
        const coupon = data as { ok?: boolean; coupon?: { type?: string; value?: number } };
        if (!coupon.ok || !coupon.coupon) {
          setCouponResult({ message: "Cupón inválido o no encontrado." });
        } else {
          setCouponResult({ message: "Cupón válido", discount: String(coupon.coupon.type) === "percent" ? `${coupon.coupon.value}%` : `-${formatCOP(Number(coupon.coupon.value))}` });
        }
      }
    } catch (error) {
      console.error(error);
      setCouponResult({ message: "Error al validar el cupón." });
    } finally {
      setCouponLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f8f8]">
      <Navbar />
      <main className="flex-1 px-4 pb-16 pt-32">
        <div className="container-shelby grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-6">
            <div className="rounded-[2rem] border border-border bg-white p-8 shadow-soft">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Mi perfil</p>
                  <h1 className="mt-3 font-display text-4xl text-primary">Hola, {user?.name.split(" ")[0] || "Cliente"}</h1>
                </div>
                <Button variant="outline" onClick={logout} className="gap-2 text-primary hover:bg-primary/5">
                  <LogOut className="h-4 w-4" /> Cerrar sesión
                </Button>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <DetailCard icon={Mail} label="Correo" value={user?.email || "-"} />
                <DetailCard icon={Phone} label="Cédula" value={user?.cedula || "-"} />
                <DetailCard icon={MapPin} label="Última ciudad" value={user?.cedula ? "Tu ciudad registrada" : "-"} />
                <DetailCard icon={Sparkles} label="Pedidos" value={`${orders.length}`} />
              </div>
            </div>

            <div className="rounded-[2rem] border border-border bg-white p-8 shadow-soft">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Historial de compras</p>
                  <h2 className="mt-3 font-display text-3xl text-primary">Tus últimos pedidos</h2>
                </div>
                <div className="text-right text-xs text-muted-foreground">Mostrando {recentOrders.length} pedidos</div>
              </div>

              {loading ? (
                <div className="mt-6 py-16 text-center text-muted-foreground">Cargando tu historial...</div>
              ) : recentOrders.length === 0 ? (
                <div className="mt-6 rounded-[1.8rem] border border-dashed border-border p-10 text-center text-muted-foreground">
                  <FileSearch className="mx-auto mb-4 h-12 w-12 text-primary" />
                  <p className="text-sm">Aún no tienes pedidos registrados.</p>
                  <Button asChild className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90">
                    <Link to="/products">Ver productos</Link>
                  </Button>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {recentOrders.map((order) => (
                    <div key={String(order.id)} className="rounded-[1.8rem] border border-border bg-[#f5f8f8] p-5 shadow-soft">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Pedido</p>
                          <p className="mt-1 font-mono text-sm text-primary">{String(order.id)}</p>
                        </div>
                        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                          <div><span className="block font-semibold text-primary">{String(order.status)}</span>Estado</div>
                          <div><span className="block font-semibold text-primary">{formatCOP(Number(order.total || 0))}</span>Total</div>
                          <div><span className="block font-semibold text-primary">{formatOrderDate(String(order.createdAt || order.created_at || ""))}</span>Fecha</div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                        <div className="rounded-2xl bg-white p-4 shadow-soft">
                          <p className="text-[10px] uppercase tracking-[0.26em] text-muted-foreground">Método</p>
                          <p className="mt-2 text-primary">{String(order.paymentMethod || "-")}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4 shadow-soft">
                          <p className="text-[10px] uppercase tracking-[0.26em] text-muted-foreground">Envío</p>
                          <p className="mt-2 text-primary">{String(order.shipping || 0) === "0" ? "Gratis" : formatCOP(Number(order.shipping || 0))}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4 shadow-soft">
                          <p className="text-[10px] uppercase tracking-[0.26em] text-muted-foreground">Cupón</p>
                          <p className="mt-2 text-primary">{String(order.couponCode || "-")}</p>
                        </div>
                        <div className="rounded-2xl bg-white p-4 shadow-soft">
                          <p className="text-[10px] uppercase tracking-[0.26em] text-muted-foreground">Descuento</p>
                          <p className="mt-2 text-primary">{order.discountAmount ? formatCOP(Number(order.discountAmount)) : "-"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-[2rem] border border-border bg-white p-8 shadow-soft">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Sparkles className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Cupones</p>
                  <h2 className="mt-2 font-display text-2xl text-primary">Validar descuento</h2>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-primary">Código de cupón</label>
                  <input value={couponCode} onChange={(event) => setCouponCode(event.target.value)} placeholder="EJEMPLO10" className="w-full rounded-2xl border border-border bg-[#f5f8f8] px-4 py-3 text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <Button onClick={handleApplyCoupon} disabled={couponLoading} className="w-full bg-primary text-primary-foreground shadow-soft hover:bg-primary/90">
                  {couponLoading ? "Validando..." : "Validar cupón"}
                </Button>
                {couponResult && (
                  <div className="rounded-2xl border border-border bg-[#f5f8f8] p-4 text-sm text-primary">
                    <p className="font-semibold">{couponResult.message}</p>
                    {couponResult.discount && <p className="mt-2">Descuento: {couponResult.discount}</p>}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border border-border bg-white p-8 shadow-soft">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Clock11 className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Servicio</p>
                  <h2 className="mt-2 font-display text-2xl text-primary">Soporte rápido</h2>
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                Si necesitas ayuda con tu orden o quieres una compra personalizada, escríbenos por WhatsApp y te respondemos rápido.
              </p>
              <Button asChild className="mt-6 w-full bg-whatsapp text-white shadow-soft hover:bg-whatsapp/90">
                <a href={`${SHELBY_WHATSAPP_URL}?text=Hola%20Shelby%2C%20necesito%20ayuda%20con%20mi%20pedido`} target="_blank" rel="noreferrer">Contactar por WhatsApp</a>
              </Button>
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
};

function DetailCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-[1.6rem] border border-border bg-[#f5f8f8] p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-white p-3 text-primary shadow-soft"><Icon className="h-4 w-4" /></div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.26em] text-muted-foreground">{label}</p>
          <p className="mt-1 font-semibold text-primary">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default Profile;
