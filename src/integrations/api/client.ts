import type { Session, User as SbUser } from "@supabase/supabase-js";

type ApiError = { message: string; code?: string };
type ApiResult<T> = Promise<{ data: T | null; error: ApiError | null }>;

const API_BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_BACKEND_URL ?? "";
const SESSION_KEY = "shelby:session";
const AUTH_LISTENERS = new Set<(event: string, session: Session | null) => void>();

type SessionUser = Partial<SbUser> & {
  user_metadata?: Record<string, unknown>;
  email?: string;
  id: string;
};

type StoredSession = { user: SessionUser; access_token: string } | null;

const readSession = (): StoredSession => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
};

const writeSession = (session: StoredSession) => {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

const emitAuthChange = (event: string, session: Session | null) => {
  AUTH_LISTENERS.forEach((listener) => listener(event, session));
};

const toSession = (stored: StoredSession): Session | null => {
  if (!stored) return null;
  return {
    access_token: stored.access_token,
    token_type: "bearer",
    user: stored.user as SbUser,
    refresh_token: stored.access_token,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  } as Session;
};

const request = async <T>(path: string, init?: RequestInit): ApiResult<T> => {
  if (!API_BASE_URL) {
    return { data: null, error: { message: "VITE_API_URL o VITE_BACKEND_URL no está configurado." } };
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      ...init,
    });
    const data = (await response.json().catch(() => null)) as T | null;
    if (!response.ok) {
      return {
        data: null,
        error: { message: (data as { message?: string; error?: string } | null)?.message ?? (data as { error?: string } | null)?.error ?? response.statusText, code: String(response.status) },
      };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Network error" } };
  }
};

class QueryBuilder<T = unknown> {
  private filters: Array<{ column: string; value: string | number | boolean }> = [];
  private orderBy: string | null = null;
  private orderAscending = true;
  private rowLimit: number | null = null;
  private singleRow = false;
  private maybeSingleRow = false;
  private payload: unknown = null;
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";

  constructor(private table: string) {}

  select(_columns?: string): this { this.action = "select"; return this; }
  insert(payload: unknown, _options?: { onConflict?: string }): this { this.action = "insert"; this.payload = payload; return this; }
  update(payload: unknown): this { this.action = "update"; this.payload = payload; return this; }
  delete(): this { this.action = "delete"; return this; }
  upsert(payload: unknown, _options?: { onConflict?: string }): this { this.action = "upsert"; this.payload = payload; return this; }
  eq(column: string, value: string | number | boolean): this { this.filters.push({ column, value }); return this; }
  or(_filters?: string): this { return this; }
  order(column: string, options?: { ascending?: boolean }): this { this.orderBy = column; this.orderAscending = options?.ascending ?? true; return this; }
  limit(value: number): this { this.rowLimit = value; return this; }
  single(): this { this.singleRow = true; return this; }
  maybeSingle(): this { this.maybeSingleRow = true; return this; }

  async execute() {
    const params = new URLSearchParams();
    params.set("action", this.action);
    if (this.orderBy) params.set("orderBy", this.orderBy);
    params.set("ascending", String(this.orderAscending));
    if (this.rowLimit !== null) params.set("limit", String(this.rowLimit));
    if (this.singleRow) params.set("single", "true");
    if (this.maybeSingleRow) params.set("maybeSingle", "true");
    if (this.filters.length) params.set("filters", JSON.stringify(this.filters));

    const init: RequestInit = { method: this.action === "select" ? "GET" : this.action === "delete" ? "DELETE" : this.action === "update" ? "PATCH" : "POST" };
    if (this.payload !== null) init.body = JSON.stringify(this.payload);

    return request<T>(`/api/data/${encodeURIComponent(this.table)}?${params.toString()}`, init);
  }

  then<TResult1 = { data: T | null; error: ApiError | null }, TResult2 = never>(onfulfilled?: ((value: { data: T | null; error: ApiError | null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.execute().then(onfulfilled, onrejected);
  }
}

const apiClient = {
  rpc: async <T>(name: string, params: Record<string, unknown> = {}) => {
    return request<T>(`/api/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  },
  auth: {
    getSession: async () => ({ data: { session: toSession(readSession()) }, error: null }),
    onAuthStateChange: (listener: (event: string, session: Session | null) => void) => {
      AUTH_LISTENERS.add(listener);
      return { data: { subscription: { unsubscribe: () => AUTH_LISTENERS.delete(listener) } } };
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const result = await request<{ session: StoredSession; user: SbUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (result.error) return { data: { session: null, user: null }, error: result.error };
      writeSession(result.data?.session ?? null);
      emitAuthChange("SIGNED_IN", toSession(result.data?.session ?? null));
      return { data: { session: toSession(result.data?.session ?? null), user: result.data?.user ?? null }, error: null };
    },
    signUp: async ({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => {
      const result = await request<{ session: StoredSession; user: SbUser }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, data: options?.data ?? {} }) });
      if (result.error) return { data: { session: null, user: null }, error: result.error };
      writeSession(result.data?.session ?? null);
      emitAuthChange("SIGNED_UP", toSession(result.data?.session ?? null));
      return { data: { session: toSession(result.data?.session ?? null), user: result.data?.user ?? null }, error: null };
    },
    verifyOtp: async ({ email, token }: { email: string; token: string; type: string }) => {
      const result = await request<{ session: StoredSession; user: SbUser }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, token }) });
      if (result.error) return { data: { session: null, user: null }, error: result.error };
      writeSession(result.data?.session ?? null);
      emitAuthChange("SIGNED_IN", toSession(result.data?.session ?? null));
      return { data: { session: toSession(result.data?.session ?? null), user: result.data?.user ?? null }, error: null };
    },
    signInWithOtp: async () => ({ data: { session: null, user: null }, error: { message: "Migrar este flujo a MySQL no ha sido implementado todavía." } }),
    updateUser: async ({ data }: { data: Record<string, unknown> }) => {
      const result = await request<{ user: SbUser }>("/api/auth/me", { method: "PATCH", body: JSON.stringify({ data }) });
      if (result.error) return { data: { user: null }, error: result.error };
      const stored = readSession();
      if (stored?.user) {
        writeSession({ ...stored, user: { ...stored.user, user_metadata: { ...(stored.user.user_metadata || {}), ...(data || {}) } } });
      }
      emitAuthChange("USER_UPDATED", toSession(readSession()));
      return { data: { user: result.data?.user ?? null }, error: null };
    },
    signOut: async () => {
      writeSession(null);
      emitAuthChange("SIGNED_OUT", null);
      return { error: null };
    },
  },
  from: <T,>(table: string) => new QueryBuilder<T>(table),
  storage: {
    from: (_bucket: string) => ({
      upload: async (path: string, file: File, _options?: { upsert?: boolean }) => {
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
          reader.readAsDataURL(file);
        });

        const result = await request<{ path: string }>("/api/storage/upload", {
          method: "POST",
          body: JSON.stringify({ path, contentBase64, mimeType: file.type }),
        });
        return result.error ? { error: result.error } : { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `${API_BASE_URL}/uploads/${path}` } }),
    }),
  },
  functions: {
    invoke: async (name: string, { body }: { body?: unknown } = {}) => request(`/api/functions/${encodeURIComponent(name)}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
  },
};

export { apiClient as supabase };
