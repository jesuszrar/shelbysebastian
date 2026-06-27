import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Mail, Lock, LogIn, User as UserIcon, ArrowLeft, ShieldCheck, Truck, Sparkles } from "lucide-react";
import heroImg from "@/assets/hero-warehouse.jpg";
import logo from "@/assets/products/logo.png";

const loginSchema = z.object({
  cedula: z.string().trim().min(5, "Ingresa tu cédula").max(20),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
});
const registerSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  cedula: z.string().trim().min(5, "Cédula requerida").max(20),
  email: z.string().email("Email válido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
});

const Login = () => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") || "/";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [cedula, setCedula] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});

    const schema = mode === "login" ? loginSchema : registerSchema;
    const parsed = schema.safeParse(mode === "login" ? { cedula, password } : { name, cedula, email, password });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { fe[i.path[0] as string] = i.message; });
      setErrors(fe);
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await login(cedula, password);
        toast.success("¡Bienvenido de nuevo!");
        navigate(redirect);
      } else {
        await register(name, cedula, email, password);
        toast.success("Cuenta creada", { description: "Ya puedes iniciar sesión." });
        navigate(redirect);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No pudimos completar la acción");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* LEFT: Form */}
      <div className="flex-1 flex flex-col bg-background px-6 sm:px-12 py-8 lg:px-16">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-smooth mb-8">
          <ArrowLeft className="h-4 w-4" /> Volver al inicio
        </Link>
        <div className="flex items-center gap-3 mb-12">
          <img src={logo} alt="Shelby" className="h-12 w-12 rounded-md shadow-soft" />
          <div>
            <div className="font-display text-xl tracking-wide text-secondary">SHELBY</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground -mt-1">Importaciones</div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto">
          <div className="mb-8">
            <h1 className="font-display text-4xl sm:text-5xl text-secondary leading-tight">
              {mode === "login" ? "Bienvenido de nuevo" : "Crea tu cuenta"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {mode === "login" ? "Accede para continuar tu compra" : "Regístrate y compra fácil y rápido"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <>
                <div>
                  <label className="text-sm font-medium text-secondary block mb-1.5">Nombre completo</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth" autoComplete="name" />
                  </div>
                  {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-secondary block mb-1.5">Cédula</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input type="text" value={cedula} onChange={(e) => setCedula(e.target.value)} placeholder="12345678"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth" autoComplete="off" />
                  </div>
                  {errors.cedula && <p className="text-xs text-destructive mt-1">{errors.cedula}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-secondary block mb-1.5">Correo electrónico</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth" autoComplete="email" />
                  </div>
                  {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
                </div>
              </>
            )}

            <div>
              <label className="text-sm font-medium text-secondary block mb-1.5">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth" autoComplete={mode === "login" ? "current-password" : "new-password"} />
              </div>
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
            </div>

            {mode === "login" && (
              <div>
                <label className="text-sm font-medium text-secondary block mb-1.5">Cédula</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input type="text" value={cedula} onChange={(e) => setCedula(e.target.value)} placeholder="12345678"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth" autoComplete="off" />
                </div>
                {errors.cedula && <p className="text-xs text-destructive mt-1">{errors.cedula}</p>}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                  Procesando...
                </span>
              ) : (
                <><LogIn className="h-4 w-4" /> {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            {mode === "login" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErrors({}); }} className="text-primary font-semibold hover:underline">
              {mode === "login" ? "Regístrate" : "Inicia sesión"}
            </button>
          </p>
        </div>
      </div>

      {/* RIGHT: Image with overlay */}
      <div className="hidden lg:block relative flex-1 max-w-[55%]">
        <img src={heroImg} alt="Productos Shelby Importaciones" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-login" />
        <div className="relative z-10 h-full flex flex-col justify-end p-12 xl:p-16 text-background">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-primary-glow text-xs font-semibold tracking-wider uppercase backdrop-blur-sm w-fit">
            <Sparkles className="h-3.5 w-3.5" /> Tienda 100% colombiana
          </span>
          <h2 className="font-display text-5xl xl:text-6xl mt-6 leading-[0.95] text-balance">
            Compra fácil y rápido,<br />
            <span className="text-primary-glow">imprime tu éxito.</span>
          </h2>
          <p className="mt-5 text-background/80 max-w-md text-lg">
            Impresoras térmicas, lectores y suministros con envío a todo Colombia y asesoría real por WhatsApp.
          </p>
          <div className="grid grid-cols-3 gap-6 mt-10 max-w-lg">
            {[
              { icon: Truck, k: "+1.500", v: "Envíos hechos" },
              { icon: ShieldCheck, k: "30 días", v: "Garantía" },
              { icon: Sparkles, k: "4.9 ★", v: "Clientes felices" },
            ].map((s) => (
              <div key={s.v}>
                <s.icon className="h-5 w-5 text-primary-glow mb-2" />
                <div className="font-display text-2xl">{s.k}</div>
                <div className="text-xs text-background/70 uppercase tracking-wider">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
export default Login;
