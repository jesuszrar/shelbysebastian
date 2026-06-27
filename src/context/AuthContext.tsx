import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User as SbUser } from "@supabase/supabase-js";

export type User = { id: string; name: string; email: string; cedula?: string };

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (cedula: string, password: string) => Promise<void>;
  register: (name: string, cedula: string, email: string, password: string) => Promise<void>;
  verifyRegistrationCode: (email: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const toUser = (u: SbUser | null | undefined): User | null =>
  u
    ? {
        id: u.id,
        email: u.email ?? "",
        name: (u.user_metadata?.name as string) ?? (u.email?.split("@")[0] ?? "Cliente"),
        cedula: (u.user_metadata?.cedula as string) ?? undefined,
      }
    : null;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(toUser(s?.user));
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(toUser(data.session?.user));
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const findEmailByCedula = async (cedula: string) => {
    const { data, error } = await supabase.from('profiles').select('email').eq('cedula', cedula).single();
    if (error) {
      console.error('Error fetching profile by cedula', error);
      return null;
    }
    return data?.email ?? null;
  };

  const login = async (cedula: string, password: string) => {
    const email = await findEmailByCedula(cedula);
    if (!email) {
      throw new Error('Cédula no registrada. Regístrate primero.');
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Cédula o contraseña incorrectos' : error.message);
  };

  const register = async (name: string, cedula: string, email: string, password: string) => {
    const normalizedEmail = email.trim();
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: password.trim(),
      options: {
        data: { name: name.trim(), cedula: cedula.trim() },
      },
    });
    if (error) throw new Error(error.message);

    if (!data.session) {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: password.trim(),
      });
      if (signInError || !signInData.session) {
        throw new Error(signInError?.message ?? 'No se pudo iniciar sesión automáticamente.');
      }
    }
  };

  const verifyRegistrationCode = async (email: string, token: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "email",
    });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error("No se pudo verificar el código. Intenta de nuevo.");
  };

  const logout = async () => { await supabase.auth.signOut(); };

  return (
    <AuthContext.Provider value={{ user, session, isAuthenticated: !!user, loading, login, register, verifyRegistrationCode, logout, isAdmin: !!user?.cedula && Boolean((session?.user?.user_metadata as any)?.is_admin) }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
