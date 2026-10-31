import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getStoredSession, saveSession, clearSession, onAuthStateChange, SESSION_EXPIRED_EVENT, resolveApiBaseUrl, syncProfile, type SessionUser, type StoredSession } from "@/integrations/api/client";
import { isAdminUser } from "./authUtils";

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

const normalizeCedula = (cedula: string) => cedula.replace(/\D/g, "").trim();

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSessionUser = (value: unknown): value is SessionUser => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return false;
  if (["email", "name", "cedula"].some((key) => value[key] !== undefined && typeof value[key] !== "string")) return false;
  if (value.is_admin !== undefined && typeof value.is_admin !== "boolean") return false;
  if (value.user_metadata !== undefined) {
    if (!isRecord(value.user_metadata)) return false;
    if (["name", "cedula"].some((key) => value.user_metadata[key] !== undefined && typeof value.user_metadata[key] !== "string")) return false;
    if (value.user_metadata.is_admin !== undefined && typeof value.user_metadata.is_admin !== "boolean") return false;
  }
  return true;
};

const isStoredSession = (value: unknown): value is Exclude<StoredSession, null> =>
  isRecord(value) &&
  typeof value.access_token === "string" &&
  Boolean(value.access_token.trim()) &&
  isSessionUser(value.user);

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

  const login = async (cedula: string, password: string) => {
    const normalizedCedula = normalizeCedula(cedula);
    const response = await fetch(getAuthUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ cedula: normalizedCedula, password: password.trim() }),
    });

    const data: unknown = await response.json().catch(() => null);
    const body = isRecord(data) ? data : null;
    if (!response.ok) {
      const backendError = typeof body?.error === "string" ? body.error.trim() : "";
      const fallbackMessage = response.status === 401
        ? "Cédula o contraseña incorrectas."
        : response.status === 403
          ? "No tienes autorización para iniciar sesión."
          : response.status >= 500
            ? "El servicio de inicio de sesión no está disponible. Intenta nuevamente más tarde."
            : "No se pudo iniciar sesión. Intenta nuevamente.";
      throw new Error(backendError || fallbackMessage);
    }

    const sessionCandidate = body?.session;
    const userCandidate = body?.user;
    if (!isStoredSession(sessionCandidate) || !isSessionUser(userCandidate)) {
      throw new Error("El servidor devolvió una respuesta inválida al iniciar sesión. Intenta nuevamente.");
    }

    saveSession(sessionCandidate);
    setSession(sessionCandidate);
    setUser(toUser(sessionCandidate.user));

    const sessionUserName = userCandidate.user_metadata?.name as string ?? userCandidate.name ?? userCandidate.email?.split("@")[0] ?? "Cliente";
    await syncProfile(userCandidate, normalizedCedula, sessionUserName, sessionCandidate.access_token);
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

    await syncProfile(result.user, normalizedCedula, name.trim(), result.session.access_token);

    saveSession(result.session);
    setSession(result.session);
    setUser(toUser(result.session.user));
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
        isAdmin: isAdminUser(user, session),
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
