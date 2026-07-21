import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/api/client";
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

const ACTIVE_CEDULA_STORAGE_KEY = "shelby_active_cedula";
const CEDULA_EMAIL_STORAGE_KEY = "shelby_cedula_email_map";
const ADMIN_CEDULA = "1108758522";

const normalizeCedula = (cedula: string) => cedula.replace(/\D/g, "").trim();

const setActiveCedula = (cedula: string) => {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(ACTIVE_CEDULA_STORAGE_KEY, cedula);
};

const getActiveCedula = () => {
  if (typeof window === "undefined") return null;

  return window.localStorage.getItem(ACTIVE_CEDULA_STORAGE_KEY);
};

const clearActiveCedula = () => {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(ACTIVE_CEDULA_STORAGE_KEY);
};

const readCedulaEmailMap = (): Record<string, string> => {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(CEDULA_EMAIL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const writeCedulaEmailMap = (cedula: string, email: string) => {
  if (typeof window === "undefined") return;

  const current = readCedulaEmailMap();
  current[normalizeCedula(cedula)] = email;
  window.localStorage.setItem(CEDULA_EMAIL_STORAGE_KEY, JSON.stringify(current));
};

const persistCedulaEmail = async (cedula: string, email: string) => {
  const normalizedCedula = normalizeCedula(cedula);

  writeCedulaEmailMap(normalizedCedula, email);

  const { error } = await supabase
    .from("cedula_emails")
    .upsert({ cedula: normalizedCedula, email: email.trim() }, { onConflict: "cedula" });

  if (error) {
    console.error("Error saving cedula email map", error);
  }
};

const toUser = (u: SbUser | null | undefined): User | null =>
  u
    ? {
        id: u.id,
        email: u.email ?? "",
        name: (u.user_metadata?.name as string) ?? (u.email?.split("@")[0] ?? "Cliente"),
        cedula: (u.user_metadata?.cedula as string) ?? undefined,
      }
    : null;

const syncSupabaseProfile = async (sessionUser: SbUser, cedula: string, name?: string) => {
  const userName = name ?? (sessionUser.user_metadata?.name as string) ?? sessionUser.email?.split("@")[0] ?? "Cliente";
  const isAdmin = cedula === ADMIN_CEDULA || Boolean((sessionUser.user_metadata as { is_admin?: boolean } | undefined)?.is_admin);

  const { error } = await supabase.rpc("sync_profile", {
    user_id: sessionUser.id,
    user_email: sessionUser.email ?? "",
    user_name: userName,
    user_cedula: cedula,
    user_is_admin: isAdmin,
  });

  if (error) {
    console.error("Error syncing profile", error);
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(toUser(s?.user));
    });

    const restoreSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
        if (data.session?.user) {
          setUser(toUser(data.session.user));
        } else {
          const storedSession = window.localStorage.getItem("shelby:session");
          if (storedSession) {
            try {
              const parsed = JSON.parse(storedSession) as { user?: SbUser | null };
              if (parsed.user) {
                setUser(toUser(parsed.user));
              } else {
                setUser(null);
              }
            } catch {
              setUser(null);
            }
          } else {
            setUser(null);
          }
        }
      } catch {
        const storedSession = window.localStorage.getItem("shelby:session");
        if (storedSession) {
          try {
            const parsed = JSON.parse(storedSession) as { user?: SbUser | null };
            setUser(parsed.user ? toUser(parsed.user) : null);
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };

    void restoreSession();
    return () => sub.subscription.unsubscribe();
  }, []);

  const findEmailByCedula = async (cedula: string) => {
    const normalizedCedula = normalizeCedula(cedula);

    const { data: mapRow, error: mapError } = await supabase
      .from("cedula_emails")
      .select("email")
      .eq("cedula", normalizedCedula)
      .maybeSingle();

    if (!mapError && mapRow?.email) {
      return mapRow.email;
    }

    const localEmail = readCedulaEmailMap()[normalizedCedula];
    if (localEmail) {
      return localEmail;
    }

    if (mapError && mapError.code !== "PGRST116") {
      console.error("Error fetching cedula email map", mapError);
    }

    const { data: rpcEmail, error: rpcError } = await supabase.rpc('get_email_by_cedula', { lookup_cedula: normalizedCedula });
    if (!rpcError && rpcEmail) {
      return rpcEmail as string;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('email')
      .or(`cedula.eq.${normalizedCedula},cedula.eq.${cedula.trim()}`)
      .single();
    if (!error && data?.email) {
      return data.email;
    }

    if (rpcError && rpcError.code !== 'PGRST116') {
      console.error('Error fetching profile by cedula via rpc', rpcError);
    }

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching profile by cedula', error);
    }

    return null;
  };

  const login = async (cedula: string, password: string) => {
    const normalizedCedula = normalizeCedula(cedula);

    const email = await findEmailByCedula(normalizedCedula);
    if (!email) {
      throw new Error('Cédula no registrada. Regístrate primero.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });
    if (error) {
      throw new Error(error.message === 'Invalid login credentials' ? 'Cédula o contraseña incorrectos' : error.message);
    }

    setActiveCedula(normalizedCedula);
    if (data.session?.user) {
      const sessionUserName = (data.session.user.user_metadata?.name as string) ?? data.session.user.email?.split("@")[0] ?? "Cliente";
      await syncSupabaseProfile(data.session.user, normalizedCedula, sessionUserName);
    }
    if (normalizedCedula === ADMIN_CEDULA) {
      await supabase.auth.updateUser({ data: { is_admin: true } });
    }

    return data;
  };

  const register = async (name: string, cedula: string, email: string, password: string) => {
    const normalizedEmail = email.trim();
    const normalizedCedula = normalizeCedula(cedula);

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: password.trim(),
      options: {
        data: { name: name.trim(), cedula: normalizedCedula },
      },
    });
    if (error) throw new Error(error.message);
    if (!data.user) {
      throw new Error("No se pudo crear el usuario. Intenta nuevamente.");
    }

    await persistCedulaEmail(normalizedCedula, normalizedEmail);

    // Try to sync the profile immediately. If signup didn't return a session,
    // this may fail due to project auth settings, but trigger-based sync should still run.
    await syncSupabaseProfile(data.user, normalizedCedula, name.trim());

    let activeUser: SbUser | null = data.session?.user ?? null;

    if (!activeUser) {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: password.trim(),
      });

      if (signInError) {
        const message = signInError.message.toLowerCase();
        // Supabase can return this when email confirmation is required.
        if ((message.includes("email") && message.includes("confirm")) || message.includes("invalid login credentials")) {
          return;
        }
        throw new Error(signInError.message);
      }

      activeUser = signInData.session?.user ?? null;
      if (activeUser) {
        await syncSupabaseProfile(activeUser, normalizedCedula, name.trim());
      }
    }

    if (!activeUser) {
      return;
    }

    setActiveCedula(normalizedCedula);
    if (normalizedCedula === ADMIN_CEDULA) {
      await supabase.auth.updateUser({ data: { is_admin: true } });
    }
    return;
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

  const logout = async () => {
    clearActiveCedula();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isAuthenticated: !!user, loading, login, register, verifyRegistrationCode, logout, isAdmin: !!user?.cedula && (user.cedula === ADMIN_CEDULA || Boolean((session?.user?.user_metadata as any)?.is_admin)) }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
