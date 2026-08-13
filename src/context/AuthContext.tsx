import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getStoredSession, saveSession, clearSession, onAuthStateChange, SESSION_EXPIRED_EVENT, resolveApiBaseUrl, getEmailByCedula, persistCedulaEmail, syncProfile, type SessionUser, type StoredSession } from "@/integrations/api/client";
import { ADMIN_CEDULA, isAdminUser } from "./authUtils";

export type User = { id: string; name: string; email: string; cedula?: string; isAdmin?: boolean };

type AuthContextValue = {
  user: User | null;
  session: StoredSession | null;
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

const persistCedulaEmailLocal = async (cedula: string, email: string, accessToken?: string) => {
  const normalizedCedula = normalizeCedula(cedula);
  writeCedulaEmailMap(normalizedCedula, email);
  const ok = await persistCedulaEmail(normalizedCedula, email.trim(), accessToken);
  if (!ok) {
    console.error("Error saving cedula email map to backend");
  }
};

const toUser = (u: SessionUser | null | undefined): User | null =>
  u
    ? {
        id: u.id,
        email: u.email ?? "",
        name: (u.user_metadata?.name as string) ?? u.name ?? u.email?.split("@")[0] ?? "Cliente",
        cedula: (u.user_metadata?.cedula as string) ?? u.cedula ?? undefined,
        isAdmin: Boolean(u.user_metadata?.is_admin ?? u.is_admin),
      }
    : null;

const getAuthUrl = (path: string) => {
  const baseUrl = resolveApiBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : path;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const [session, setSession] = useState<StoredSession>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const subscription = onAuthStateChange((event, s) => {
      setSession(s);
      setUser(toUser(s?.user));
      if (event === SESSION_EXPIRED_EVENT) {
        setSession(null);
        setUser(null);
        clearActiveCedula();
        if (typeof window !== "undefined") {
          try {
            window.alert("La sesión expiró, inicia sesión nuevamente");
          } catch {
            // ignore
          }
        }
        navigate("/login");
      }
    });

    const restoreSession = async () => {
      try {
        const stored = getStoredSession();
        setSession(stored);
        setUser(toUser(stored?.user));
      } finally {
        setLoading(false);
      }
    };

    void restoreSession();
    return () => subscription.unsubscribe();
  }, [navigate]);

  const findEmailByCedula = async (cedula: string) => {
    const normalizedCedula = normalizeCedula(cedula);

    const localEmail = readCedulaEmailMap()[normalizedCedula];
    if (localEmail) {
      return localEmail;
    }

    const backendEmail = await getEmailByCedula(normalizedCedula);
    if (backendEmail) {
      return backendEmail;
    }

    return null;
  };

  const login = async (cedula: string, password: string) => {
    const normalizedCedula = normalizeCedula(cedula);
    const email = await findEmailByCedula(normalizedCedula);
    if (!email) {
      throw new Error("Cédula no registrada. Regístrate primero.");
    }

    const response = await fetch(getAuthUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email.trim(), password: password.trim() }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (data as { error?: string } | null)?.error ?? response.statusText;
      throw new Error(String(message));
    }

    const result = data as { session?: StoredSession | null; user?: SessionUser | null };
    if (!result.session || !result.user) {
      throw new Error("No se pudo iniciar sesión. Intenta nuevamente.");
    }

    saveSession(result.session);
    setSession(result.session);
    setUser(toUser(result.session.user));
    setActiveCedula(normalizedCedula);

    const sessionUserName = result.user.user_metadata?.name as string ?? result.user.name ?? result.user.email?.split("@")[0] ?? "Cliente";
    await syncProfile(result.user, normalizedCedula, sessionUserName, result.session.access_token);
  };

  const register = async (name: string, cedula: string, email: string, password: string) => {
    const normalizedEmail = email.trim();
    const normalizedCedula = normalizeCedula(cedula);

    const response = await fetch(getAuthUrl("/api/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: normalizedEmail, password: password.trim(), data: { name: name.trim(), cedula: normalizedCedula } }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (data as { error?: string } | null)?.error ?? response.statusText;
      throw new Error(String(message));
    }

    const result = data as { session?: StoredSession | null; user?: SessionUser | null };
    if (!result.session || !result.user) {
      throw new Error("No se pudo crear el usuario. Intenta nuevamente.");
    }

    await persistCedulaEmailLocal(normalizedCedula, normalizedEmail, result.session.access_token);
    await syncProfile(result.user, normalizedCedula, name.trim(), result.session.access_token);

    saveSession(result.session);
    setSession(result.session);
    setUser(toUser(result.session.user));
    setActiveCedula(normalizedCedula);
  };

  const verifyRegistrationCode = async (email: string, token: string) => {
    const response = await fetch(getAuthUrl("/api/auth/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), token: token.trim() }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (data as { error?: string } | null)?.error ?? response.statusText;
      throw new Error(String(message));
    }

    const result = data as { session?: StoredSession | null; user?: SessionUser | null };
    if (!result.session || !result.user) {
      throw new Error("No se pudo verificar el código. Intenta de nuevo.");
    }

    saveSession(result.session);
    setSession(result.session);
    setUser(toUser(result.session.user));
  };

  const logout = async () => {
    try {
      await fetch(getAuthUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
    } catch (err) {
      console.error("logout request failed", err);
    }
    clearActiveCedula();
    clearSession();
    setSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isAuthenticated: !!user,
        loading,
        login,
        register,
        verifyRegistrationCode,
        logout,
        isAdmin: isAdminUser(user, session, getActiveCedula()),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
