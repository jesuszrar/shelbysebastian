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
  cedula: z.string().trim().min(6, "Ingresa tu cédula").max(20),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
});
const registerSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  cedula: z.string().trim().min(6, "Ingresa tu cédula").max(20),
  email: z.string().trim().email("Ingresa un correo válido").max(255),
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
      } else {
        await register(name, cedula, email, password);
        toast.success("¡Cuenta creada!");
      }
      navigate(redirect);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No pudimos completar la acción");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f5f8f8]">
      <div className="flex flex-1 flex-col bg-background px-6 py-8 sm:px-12 lg:px-16">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-smooth hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Volver al inicio
        </Link>

        <div className="mb-12 flex items-center gap-3">
          <img src={logo} alt="Shelby" className="h-12 w-12 rounded-md shadow-soft" />
          <div>
            <div className="font-display text-xl tracking-[0.14em] text-primary">SHELBY</div>
            <div className="-mt-1 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Importaciones</div>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <div className="mb-8">
            <h1 className="font-display text-4xl leading-tight text-primary sm:text-5xl">
              {mode === "login" ? "Bienvenido de nuevo" : "Crea tu cuenta"}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {mode === "login" ? "Accede para continuar tu compra" : "Regístrate y compra fácil y rápido"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-primary">Nombre completo</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" className="w-full rounded-2xl border border-border bg-white py-3 pl-10 pr-4 text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" autoComplete="name" />
                </div>
                {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-primary">Cédula</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input type="text" value={cedula} onChange={(e) => setCedula(e.target.value)} placeholder="Tu cédula" className="w-full rounded-2xl border border-border bg-white py-3 pl-10 pr-4 text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" autoComplete="username" />
              </div>
              {errors.cedula && <p className="mt-1 text-xs text-destructive">{errors.cedula}</p>}
            </div>

            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-primary">Correo electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" className="w-full rounded-2xl border border-border bg-white py-3 pl-10 pr-4 text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" autoComplete="email" />
                </div>
                {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-primary">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full rounded-2xl border border-border bg-white py-3 pl-10 pr-4 text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" autoComplete={mode === "login" ? "current-password" : "new-password"} />
              </div>
              {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password}</p>}
            </div>

            <Button type="submit" disabled={loading} className="h-12 w-full bg-primary text-primary-foreground shadow-soft hover:bg-primary/90">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Procesando...
                </span>
              ) : (
                <><LogIn className="h-4 w-4" /> {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErrors({}); }} className="font-semibold text-primary hover:underline">
              {mode === "login" ? "Regístrate" : "Inicia sesión"}
            </button>
          </p>
        </div>
      </div>

      <div className="relative hidden max-w-[55%] flex-1 lg:block">
        <img src={heroImg} alt="Productos Shelby Importaciones" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-login" />
        <div className="relative z-10 flex h-full flex-col justify-end p-12 xl:p-16 text-white">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/20 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-white/90 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" /> Tienda 100% colombiana
          </span>
          <h2 className="mt-6 font-display text-5xl leading-[0.95] xl:text-6xl">
            Compra fácil y rápido,
            <span className="mt-2 block text-primary-glow">imprime tu éxito.</span>
          </h2>
          <p className="mt-5 max-w-md text-lg text-white/80">
            Impresoras térmicas, lectores y suministros con envío a todo Colombia y asesoría real por WhatsApp.
          </p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-6">
            {[
              { icon: Truck, k: "+1.500", v: "Envíos hechos" },
              { icon: ShieldCheck, k: "30 días", v: "Garantía" },
              { icon: Sparkles, k: "4.9 ★", v: "Clientes felices" },
            ].map((s) => (
              <div key={s.v}>
                <s.icon className="mb-2 h-5 w-5 text-primary-glow" />
                <div className="font-display text-2xl">{s.k}</div>
                <div className="text-xs uppercase tracking-[0.22em] text-white/70">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
