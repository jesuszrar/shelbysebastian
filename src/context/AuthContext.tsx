import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User as SbUser } from "@supabase/supabase-js";

export type User = { id: string; name: string; email: string; cedula?: string };

const SITE_URL = import.meta.env.VITE_SITE_URL || window.location.origin;

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  loading: boolean;
  // Now login uses cedula as identifier; register requires real email for confirmation
  login: (cedula: string, password: string) => Promise<void>;
  register: (name: string, cedula: string, email: string, password: string) => Promise<void>;
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

  // Helper: generate a synthetic email from cedula so Supabase auth can work while the UI uses cedula
  const synthEmail = (cedula: string) => `${cedula.trim()}@no-reply.shelby`;

  const login = async (cedula: string, password: string) => {
    const email = synthEmail(cedula);
    const { error } = await supabase.auth.signInWithPassword({ email: email, password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Cédula o contraseña incorrectos" : error.message);
  };

  const register = async (name: string, cedula: string, email: string, password: string) => {
    // Use real email for Supabase auth (for email confirmation), store cedula in metadata
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim(), cedula: cedula.trim() }, emailRedirectTo: SITE_URL },
    });
    if (error) throw new Error(error.message);
  };

  const logout = async () => { await supabase.auth.signOut(); };

  return (
    <AuthContext.Provider value={{ user, session, isAuthenticated: !!user, loading, login, register, logout, isAdmin: !!user?.cedula && Boolean((session?.user?.user_metadata as any)?.is_admin) }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
