type ApiError = { message: string; code?: string };
type ApiResult<T> = Promise<{ data: T | null; error: ApiError | null }>;

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
  cedula?: string;
  is_admin?: boolean;
  user_metadata?: {
    name?: string;
    cedula?: string;
    is_admin?: boolean;
  };
};

export type StoredSession = { access_token: string; user: SessionUser } | null;

const resolveApiBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_BACKEND_URL ?? "";
  const fallbackFromEnv = import.meta.env.VITE_FALLBACK_API ?? "";
  const placeholderBackend = "tu-backend-en-render.com";
  const localBackend = "http://localhost:3001";

  const normalize = (value: string) => {
    const normalized = value.trim().replace(/\/$/, "");
    if (!normalized) return "";
    if (normalized.includes(placeholderBackend)) return "";
    return normalized;
  };

  const isLocalFrontendOrigin = () => {
    if (typeof window === "undefined" || !window.location?.origin) return false;
    return /^(http:\/\/localhost|http:\/\/127\.0\.0\.1|http:\/\/0\.0\.0\.0)/i.test(window.location.origin);
  };

  const resolvedConfigured = normalize(configuredUrl);
  if (resolvedConfigured) return resolvedConfigured;

  if (isLocalFrontendOrigin()) {
    return localBackend;
  }

  const resolvedFallbackFromEnv = normalize(fallbackFromEnv);
  if (resolvedFallbackFromEnv) return resolvedFallbackFromEnv;

  return "";
};

const API_BASE_URL = resolveApiBaseUrl();
export const SESSION_KEY = "shelby:session";
const AUTH_LISTENERS = new Set<(event: string, session: StoredSession | null) => void>();
export const SESSION_EXPIRED_EVENT = "SESSION_EXPIRED";

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

export const getStoredSession = (): StoredSession => readSession();
export const saveSession = (session: StoredSession) => writeSession(session);
export const clearSession = () => writeSession(null);

const buildApiUrl = (path: string) => (API_BASE_URL ? `${API_BASE_URL}${path}` : path);

export const getEmailByCedula = async (cedula: string): Promise<string | null> => {
  const url = buildApiUrl(`/api/users/email-by-cedula?cedula=${encodeURIComponent(cedula)}`);
  const response = await fetch(url, { method: "GET" });
  const data = (await response.json().catch(() => null)) as { email?: string | null } | null;
  if (!response.ok) return null;
  return data?.email ?? null;
};

export const persistCedulaEmail = async (cedula: string, email: string, accessToken?: string): Promise<boolean> => {
  const url = buildApiUrl("/api/users/cedula-email");
  const response = await fetch(url, {
    method: "POST",
    headers: buildRequestHeaders(undefined, accessToken),
    body: JSON.stringify({ cedula, email }),
  });
  if (!response.ok) {
    console.error("Error persisting cedula email", await response.text().catch(() => ""));
    return false;
  }
  return true;
};

export const syncProfile = async (sessionUser: SessionUser, cedula: string, name?: string, accessToken?: string): Promise<boolean> => {
  const url = buildApiUrl("/api/profile/sync");
  const response = await fetch(url, {
    method: "POST",
    headers: buildRequestHeaders(undefined, accessToken),
    body: JSON.stringify({
      user_id: sessionUser.id,
      user_email: sessionUser.email ?? "",
      user_name: name ?? sessionUser.user_metadata?.name ?? sessionUser.name ?? sessionUser.email?.split("@")[0] ?? "Cliente",
      user_cedula: cedula,
      user_is_admin: Boolean(sessionUser.user_metadata?.is_admin ?? sessionUser.is_admin),
    }),
  });
  if (!response.ok) {
    console.error("Error syncing profile", await response.text().catch(() => ""));
    return false;
  }
  return true;
};

export const getProfile = async (accessToken?: string): Promise<SessionUser | null> => {
  const url = buildApiUrl("/api/profile");
  const response = await fetch(url, {
    method: "GET",
    headers: buildRequestHeaders(undefined, accessToken),
  });
  const data = (await response.json().catch(() => null)) as { user?: SessionUser | null } | null;
  if (!response.ok) return null;
  return data?.user ?? null;
};

const buildQueryString = (params: Record<string, string | number | boolean | undefined> = {}) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

export const fetchData = async <T>(table: string, params: Record<string, string | number | boolean | undefined> = {}) => {
  const query = buildQueryString(params);
  return request<T>(`/api/data/${encodeURIComponent(table)}${query}`, { method: "GET" });
};

export const postData = async <T>(table: string, body: unknown) => {
  return request<T>(`/api/data/${encodeURIComponent(table)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

export const patchData = async <T>(table: string, body: unknown, filters?: Array<{ column: string; value: string | number | boolean }>) => {
  const query = filters ? buildQueryString({ filters: JSON.stringify(filters) }) : "";
  return request<T>(`/api/data/${encodeURIComponent(table)}${query}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
};

export const deleteData = async <T>(table: string, filters: Array<{ column: string; value: string | number | boolean }>) => {
  const query = buildQueryString({ filters: JSON.stringify(filters) });
  return request<T>(`/api/data/${encodeURIComponent(table)}${query}`, {
    method: "DELETE",
  });
};

export const invokeFunction = async <T>(name: string, body: unknown = {}) => {
  return request<T>(`/api/functions/${encodeURIComponent(name)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

export const uploadFile = async (path: string, file: File) => {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });

  return request<{ path: string; publicUrl: string; mimeType: string }>("/api/storage/upload", {
    method: "POST",
    body: JSON.stringify({ path, contentBase64, mimeType: file.type }),
  });
};

export const getPublicFileUrl = (path: string) => ({ publicUrl: API_BASE_URL ? `${API_BASE_URL}/uploads/${path}` : `/uploads/${path}` });

const emitAuthChange = (event: string, session: StoredSession | null) => {
  AUTH_LISTENERS.forEach((listener) => listener(event, session));
};

export const onAuthStateChange = (listener: (event: string, session: StoredSession | null) => void) => {
  AUTH_LISTENERS.add(listener);
  return { unsubscribe: () => AUTH_LISTENERS.delete(listener) };
};

export const buildRequestHeaders = (headersInit: HeadersInit | undefined, accessToken?: string) => {
  const headers = new Headers(headersInit);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken && !headers.has("Authorization") && !headers.has("authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("X-Access-Token", accessToken);
  }

  return headers;
};

export const decodeJwt = (token: string | undefined | null) => {
  try {
    if (!token) return null;
    const parts = String(token).split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(decodeURIComponent(atob(payload).split("").map(function (c) {
      return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    }).join("")));
    return decoded as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const isTokenExpired = (token: string | undefined | null) => {
  const payload = decodeJwt(token);
  const exp = payload && typeof payload.exp === "number" ? payload.exp : null;
  return exp ? exp * 1000 < Date.now() : true;
};

export const isTokenExpiringSoon = (token: string | undefined | null, minutes = 30) => {
  const payload = decodeJwt(token);
  const exp = payload && typeof payload.exp === "number" ? payload.exp : null;
  if (!exp) return true;
  const thresholdMs = minutes * 60 * 1000;
  return exp * 1000 < Date.now() + thresholdMs;
};

export const refreshSession = async (): Promise<StoredSession | null> => {
  const stored = getStoredSession();
  if (!stored?.access_token) return null;

  const url = API_BASE_URL ? `${API_BASE_URL}/api/auth/refresh` : `/api/auth/refresh`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildRequestHeaders(undefined, stored.access_token),
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as { session?: StoredSession | null } | null;
    if (!data?.session) return null;
    saveSession(data.session);
    emitAuthChange("SIGNED_IN", data.session);
    return data.session;
  } catch {
    return null;
  }
};

const request = async <T>(path: string, init?: RequestInit): ApiResult<T> => {
  if (!API_BASE_URL) {
    return { data: null, error: { message: "VITE_API_URL o VITE_BACKEND_URL no está configurado." } };
  }

  const requiresAuth =
    path.startsWith("/api/data/") ||
    path.startsWith("/api/rpc/") ||
    path.startsWith("/api/auth/me") ||
    path.startsWith("/api/functions/redeem-coupon") ||
    path.startsWith("/api/functions/mp-webhook") ||
    path.startsWith("/api/profile") ||
    path.startsWith("/api/users");
  const isAdminMutation = path.includes("/api/data/coupons") || path.includes("/api/data/profiles");

  try {
    let storedSession = getStoredSession();
    const baseUrl = API_BASE_URL || "";
    const targetPath = path.startsWith("/") ? path : `/${path}`;
    const url = baseUrl ? `${baseUrl}${targetPath}` : targetPath;

    const rawStoredSession = window.localStorage.getItem(SESSION_KEY);
    console.info("[auth] stored session raw", rawStoredSession ? rawStoredSession.slice(0, 200) : null);

    const isAuthEndpoint = path.startsWith("/api/auth");

    if (storedSession?.access_token && !isAuthEndpoint) {
      if (isTokenExpired(storedSession.access_token)) {
        clearSession();
        emitAuthChange(SESSION_EXPIRED_EVENT, null);
        if (typeof window !== "undefined") {
          try {
            window.alert("La sesión expiró, inicia sesión nuevamente");
            window.location.href = "/login";
          } catch {
            // ignore
          }
        }
        return { data: null, error: { message: "La sesión expiró, inicia sesión nuevamente", code: "401" } };
      }

      if (isTokenExpiringSoon(storedSession.access_token, 30)) {
        const refreshedSession = await refreshSession();
        if (refreshedSession) {
          storedSession = refreshedSession;
        } else {
          clearSession();
          emitAuthChange(SESSION_EXPIRED_EVENT, null);
          if (typeof window !== "undefined") {
            try {
              window.alert("La sesión expiró, inicia sesión nuevamente");
              window.location.href = "/login";
            } catch {
              // ignore
            }
          }
          return { data: null, error: { message: "La sesión expiró, inicia sesión nuevamente", code: "401" } };
        }
      }
    }

    const jwtPayload = decodeJwt(storedSession?.access_token);
    const tokenExp = jwtPayload && typeof jwtPayload.exp === "number" ? jwtPayload.exp : null;
    const tokenExpDate = tokenExp ? new Date(tokenExp * 1000).toISOString() : null;
    const now = Date.now();
    const expired = tokenExp ? tokenExp * 1000 < now : false;

    const headers = buildRequestHeaders(init?.headers, storedSession?.access_token);

    const hasToken = Boolean(storedSession?.access_token);
    const tokenLength = storedSession?.access_token?.length ?? 0;
    console.info("[auth] outgoing request", {
      path,
      hasToken,
      tokenLength,
      tokenExpDate,
      expired,
      hasAuthorizationHeader: headers.has("Authorization") || headers.has("authorization"),
      hasXAccessTokenHeader: headers.has("X-Access-Token") || headers.has("x-access-token"),
      requiresAuth,
      isAdminMutation,
    });

    if ((requiresAuth || isAdminMutation) && !storedSession?.access_token) {
      return {
        data: null,
        error: { message: "No hay sesión activa. Inicia sesión nuevamente para continuar.", code: "401" },
      };
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });
    const data = (await response.json().catch(() => null)) as T | null;
    if (!response.ok) {
      const responseMessage = (data as { message?: string; error?: string } | null)?.message ?? (data as { error?: string } | null)?.error ?? response.statusText;
      const normalizedMessage = String(responseMessage ?? "").toLowerCase();
      const isExpiredJwt = response.status === 401 && normalizedMessage.includes("jwt expired");
      if (isExpiredJwt) {
        clearSession();
        emitAuthChange(SESSION_EXPIRED_EVENT, null);
        if (typeof window !== "undefined") {
          try {
            window.alert("La sesión expiró, inicia sesión nuevamente");
            window.location.href = "/login";
          } catch {
            // ignore
          }
        }
        return {
          data: null,
          error: { message: "La sesión expiró, inicia sesión nuevamente", code: String(response.status) },
        };
      }

      return {
        data: null,
        error: { message: responseMessage, code: String(response.status) },
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
  from: <T,>(table: string) => new QueryBuilder<T>(table),
  payments: {
    createWompiPayment: async (body: {
      products: Array<{ id?: string; name?: string; quantity?: number; unit_price?: number }>;
      total: number;
      customerEmail: string;
      reference: string;
      paymentMethod: string;
      redirectUrl?: string;
      customerName?: string;
      customerPhone?: string;
    }) => request<{ ok: boolean; paymentUrl: string | null; pendingWithoutPaymentUrl?: boolean; transaction: Record<string, unknown>; methods: Array<{ id: string; name: string; available: boolean }> }>('/api/payments/create-wompi-payment', { method: 'POST', body: JSON.stringify(body) }),
  },
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

export { resolveApiBaseUrl };
export type ApiClient = typeof apiClient;
export const api = apiClient;
