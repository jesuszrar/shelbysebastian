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

const PROFILE_FALLBACK_STORAGE_KEY = "shelby_profile_fallbacks";
const AUTH_FALLBACK_STORAGE_KEY = "shelby_auth_fallbacks";
const ACTIVE_CEDULA_STORAGE_KEY = "shelby_active_cedula";
const ADMIN_CEDULA = "1108758522";

type ProfileFallback = {
  email: string;
  name: string;
  cedula: string;
};

type AuthFallback = ProfileFallback & {
  id: string;
  passwordHash: string;
  is_admin: boolean;
};

const readProfileFallbacks = (): Record<string, ProfileFallback> => {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(PROFILE_FALLBACK_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ProfileFallback>) : {};
  } catch {
    return {};
  }
};

const writeProfileFallback = (profile: ProfileFallback) => {
  if (typeof window === "undefined") return;

  const fallbacks = readProfileFallbacks();
  fallbacks[profile.cedula] = profile;
  window.localStorage.setItem(PROFILE_FALLBACK_STORAGE_KEY, JSON.stringify(fallbacks));
};

const readAuthFallbacks = (): Record<string, AuthFallback> => {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(AUTH_FALLBACK_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, AuthFallback>) : {};
  } catch {
    return {};
  }
};

const writeAuthFallback = (authFallback: AuthFallback) => {
  if (typeof window === "undefined") return;

  const fallbacks = readAuthFallbacks();
  fallbacks[authFallback.cedula] = authFallback;
  window.localStorage.setItem(AUTH_FALLBACK_STORAGE_KEY, JSON.stringify(fallbacks));
};

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

const hashPassword = async (password: string) => {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        setUser(toUser(data.session.user));
      } else {
        const localFallbacks = readAuthFallbacks();
        const activeCedula = getActiveCedula();
        const fallback = (activeCedula ? localFallbacks[activeCedula] : null) ?? Object.values(localFallbacks)[0] ?? null;
        setUser(
          fallback
            ? {
                id: fallback.id,
                email: fallback.email,
                name: fallback.name,
                cedula: fallback.cedula,
              }
            : null,
        );
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const buildLocalUser = (fallback: AuthFallback): User => ({
    id: fallback.id,
    email: fallback.email,
    name: fallback.name,
    cedula: fallback.cedula,
  });

  const findEmailByCedula = async (cedula: string) => {
    const { data: rpcEmail, error: rpcError } = await supabase.rpc('get_email_by_cedula', { lookup_cedula: cedula });
    if (!rpcError && rpcEmail) {
      return rpcEmail as string;
    }

    const fallback = readProfileFallbacks()[cedula.trim()];
    if (fallback?.email) {
      return fallback.email;
    }

    const { data, error } = await supabase.from('profiles').select('email').eq('cedula', cedula).single();
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
    const normalizedCedula = cedula.trim();
    const localFallback = readAuthFallbacks()[normalizedCedula];

    if (localFallback) {
      const passwordHash = await hashPassword(password.trim());
      if (localFallback.passwordHash !== passwordHash) {
        throw new Error('Cédula o contraseña incorrectos');
      }

      const { data: localSignIn, error: localSignInError } = await supabase.auth.signInWithPassword({
        email: localFallback.email.trim(),
        password: password.trim(),
      });

      if (!localSignInError && localSignIn.session) {
        await syncSupabaseProfile(localSignIn.session.user, normalizedCedula, localFallback.name);
        setActiveCedula(normalizedCedula);
        if (normalizedCedula === ADMIN_CEDULA) {
          await supabase.auth.updateUser({ data: { is_admin: true } });
        }
        return localSignIn;
      }

      const { data: localSignUp, error: localSignUpError } = await supabase.auth.signUp({
        email: localFallback.email.trim(),
        password: password.trim(),
        options: {
          data: {
            name: localFallback.name,
            cedula: localFallback.cedula,
          },
        },
      });

      if (!localSignUpError) {
        const signedUpUser = localSignUp.user ?? null;
        const { data: postSignIn, error: postSignInError } = await supabase.auth.signInWithPassword({
          email: localFallback.email.trim(),
          password: password.trim(),
        });

        if (!postSignInError && postSignIn.session) {
          await syncSupabaseProfile(postSignIn.session.user, normalizedCedula, localFallback.name);
          setActiveCedula(normalizedCedula);
          if (normalizedCedula === ADMIN_CEDULA) {
            await supabase.auth.updateUser({ data: { is_admin: true } });
          }
          return postSignIn;
        }

        if (signedUpUser) {
          await supabase.from('profiles').upsert(
            {
              id: signedUpUser.id,
              email: localFallback.email.trim(),
              name: localFallback.name,
              cedula: localFallback.cedula,
              is_admin: normalizedCedula === ADMIN_CEDULA,
            },
            { onConflict: 'id' },
          );
        }
      }

      setActiveCedula(normalizedCedula);
      setUser(buildLocalUser(localFallback));
      return;
    }

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
      await syncSupabaseProfile(data.session.user, normalizedCedula, name.trim());
    }
    if (normalizedCedula === ADMIN_CEDULA) {
      await supabase.auth.updateUser({ data: { is_admin: true } });
    }

    return data;
  };

  const register = async (name: string, cedula: string, email: string, password: string) => {
    const normalizedEmail = email.trim();
    const normalizedCedula = cedula.trim();
    const fallbackId = crypto.randomUUID();
    const passwordHash = await hashPassword(password.trim());

    writeProfileFallback({
      email: normalizedEmail,
      name: name.trim(),
      cedula: normalizedCedula,
    });

    writeAuthFallback({
      id: fallbackId,
      email: normalizedEmail,
      name: name.trim(),
      cedula: normalizedCedula,
      passwordHash,
      is_admin: normalizedCedula === ADMIN_CEDULA,
    });

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: password.trim(),
      options: {
        data: { name: name.trim(), cedula: normalizedCedula },
      },
    });
    if (error) throw new Error(error.message);

    if (data.user) {
      const profile = {
        id: data.user.id,
        name: name.trim(),
        email: normalizedEmail,
        cedula: normalizedCedula,
        is_admin: normalizedCedula === ADMIN_CEDULA,
      };
      const { error: profileError } = await supabase.from('profiles').upsert(profile, { onConflict: 'id' }).select().single();
      if (profileError) {
        console.error('Error creating profile after signup', profileError);
      }

      writeProfileFallback({
        email: normalizedEmail,
        name: name.trim(),
        cedula: normalizedCedula,
      });

      writeAuthFallback({
        id: data.user.id,
        email: normalizedEmail,
        name: name.trim(),
        cedula: normalizedCedula,
        passwordHash,
        is_admin: normalizedCedula === ADMIN_CEDULA,
      });
    }

    if (!data.session) {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: password.trim(),
      });

      if (!signInError && signInData?.session && normalizedCedula === ADMIN_CEDULA) {
        setActiveCedula(normalizedCedula);
        await supabase.auth.updateUser({ data: { is_admin: true } });
      }
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
