import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock11, CreditCard, FileSearch, LayoutGrid, LogOut, MapPin, Mail, Phone, Sparkles } from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/api/client";
import { formatCOP } from "@/data/products";
import { toast } from "sonner";

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
        const result = await supabase.from("orders").select("id,total,shipping,status,paymentMethod,customerCity,customerAddress,createdAt,created_at,couponCode,discountAmount").eq("userId", user.id);
        if (result.error) {
          console.error(result.error);
          setOrders([]);
        } else {
          setOrders((result.data as Array<Record<string, unknown>>) || []);
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
      .sort((a, b) => new Date(String(b.createdAt || b.created_at || "")).getTime() - new Date(String(a.createdAt || a.created_at || "")).getTime())
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
      const result = await supabase.from("coupons").select("code,type,value,minimumSubtotal,expiresAt,active").eq("code", code).single();
      if (result.error || !result.data) {
        setCouponResult({ message: "Cupón inválido o no encontrado." });
      } else {
        const coupon = result.data as Record<string, unknown>;
        if (!coupon.active) {
          setCouponResult({ message: "Este cupón ya no está activo." });
        } else if (coupon.expiresAt && new Date(String(coupon.expiresAt)).getTime() < Date.now()) {
          setCouponResult({ message: "El cupón ha expirado." });
        } else {
          setCouponResult({ message: "Cupón válido", discount: String(coupon.type) === "percent" ? `${coupon.value}%` : `-${formatCOP(Number(coupon.value))}` });
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
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-16 px-4">
        <div className="container-shelby grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-6">
            <div className="bg-card border border-border rounded-3xl p-8 shadow-soft">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-primary font-semibold">Mi perfil</p>
                  <h1 className="font-display text-4xl text-secondary mt-3">Hola, {user?.name.split(" ")[0] || "Cliente"}</h1>
                </div>
                <Button variant="outline" onClick={logout} className="gap-2">
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

            <div className="bg-card border border-border rounded-3xl p-8 shadow-soft">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-primary font-semibold">Historial de compras</p>
                  <h2 className="font-display text-3xl text-secondary mt-3">Tus últimos pedidos</h2>
                </div>
                <div className="text-right text-xs text-muted-foreground">Mostrando {recentOrders.length} pedidos</div>
              </div>

              {loading ? (
                <div className="mt-6 py-16 text-center text-muted-foreground">Cargando tu historial...</div>
              ) : recentOrders.length === 0 ? (
                <div className="mt-6 rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">
                  <FileSearch className="mx-auto h-12 w-12 text-primary mb-4" />
                  <p className="text-sm">Aún no tienes pedidos registrados.</p>
                  <Button asChild className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90"><Link to="/products">Ver productos</Link></Button>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {recentOrders.map((order) => (
                    <div key={String(order.id)} className="rounded-3xl border border-border bg-background p-5 shadow-soft">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Pedido</p>
                          <p className="font-mono text-sm text-secondary mt-1">{String(order.id)}</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3 text-sm text-muted-foreground">
                          <div><span className="block text-secondary font-semibold">{String(order.status)}</span>Estado</div>
                          <div><span className="block text-secondary font-semibold">{formatCOP(Number(order.total || 0))}</span>Total</div>
                          <div><span className="block text-secondary font-semibold">{new Date(String(order.createdAt || order.created_at || "")).toLocaleDateString("es-CO")}</span>Fecha</div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm text-muted-foreground">
                        <div className="rounded-2xl bg-muted/40 p-4">
                          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Método</p>
                          <p className="mt-2 text-secondary">{String(order.paymentMethod || "-")}</p>
                        </div>
                        <div className="rounded-2xl bg-muted/40 p-4">
                          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Envío</p>
                          <p className="mt-2 text-secondary">{String(order.shipping || 0) === "0" ? "Gratis" : formatCOP(Number(order.shipping || 0))}</p>
                        </div>
                        <div className="rounded-2xl bg-muted/40 p-4">
                          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Cupón</p>
                          <p className="mt-2 text-secondary">{String(order.couponCode || "-")}</p>
                        </div>
                        <div className="rounded-2xl bg-muted/40 p-4">
                          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Descuento</p>
                          <p className="mt-2 text-secondary">{order.discountAmount ? formatCOP(Number(order.discountAmount)) : "-"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="bg-card border border-border rounded-3xl p-8 shadow-soft">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Sparkles className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-primary font-semibold">Cupones</p>
                  <h2 className="font-display text-2xl text-secondary mt-2">Validar descuento</h2>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-secondary block mb-2">Código de cupón</label>
                  <input
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value)}
                    placeholder="EJEMPLO10"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <Button onClick={handleApplyCoupon} disabled={couponLoading} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft">
                  {couponLoading ? "Validando..." : "Validar cupón"}
                </Button>
                {couponResult && (
                  <div className="rounded-2xl bg-muted/40 border border-border p-4 text-sm text-secondary">
                    <p className="font-semibold">{couponResult.message}</p>
                    {couponResult.discount && <p className="mt-2">Descuento: {couponResult.discount}</p>}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card border border-border rounded-3xl p-8 shadow-soft">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Clock11 className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-primary font-semibold">Servicio</p>
                  <h2 className="font-display text-2xl text-secondary mt-2">Soporte rápido</h2>
                </div>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">
                Si necesitas ayuda con tu orden o quieres una orden personalizada, escríbenos por WhatsApp y te respondemos rápido.
              </p>
              <Button asChild className="mt-6 w-full bg-whatsapp text-white hover:bg-whatsapp/90 shadow-soft">
                <a href="https://wa.me/573228426561?text=Hola%20Shelby%2C%20necesito%20ayuda%20con%20mi%20pedido" target="_blank" rel="noreferrer">Contactar por WhatsApp</a>
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
    <div className="rounded-3xl border border-border bg-background p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-muted p-3 text-primary"><Icon className="h-4 w-4" /></div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
          <p className="mt-1 font-semibold text-secondary">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default Profile;
