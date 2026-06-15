import axios, {
  type AxiosInstance,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from "axios";

// ---------------------------------------------------------------------------
// Token store (in-memory only — survives refresh via cookie-based recovery)
// ---------------------------------------------------------------------------
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common["Authorization"];
  }
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------
export const apiClient: AxiosInstance = axios.create({
  baseURL: "/api",
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

// ---------------------------------------------------------------------------
// 401 → silent refresh → retry (with Promise lock for concurrent requests)
// ---------------------------------------------------------------------------
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = apiClient
    .post<{ accessToken: string }>("/auth/refresh")
    .then((r) => r.data.accessToken)
    .catch(() => null)
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string | null) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(token: string | null) {
  failedQueue.forEach((p) => (token ? p.resolve(token) : p.reject(null)));
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;

    // 401 — attempt refresh & retry
    if (status === 401) {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

      if (originalRequest._retry) {
        // Already retried — give up, redirect to login
        if (typeof window !== "undefined") window.location.href = "/login";
        return Promise.reject(error);
      }

      if (!isRefreshing) {
        isRefreshing = true;
        const newToken = await refreshAccessToken();
        processQueue(newToken);
        isRefreshing = false;

        if (newToken) {
          setAccessToken(newToken);
          originalRequest._retry = true;
          originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        }
      } else {
        // Another 401 already triggered refresh — queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token) => {
              if (token) {
                originalRequest._retry = true;
                originalRequest.headers["Authorization"] = `Bearer ${token}`;
                resolve(apiClient(originalRequest));
              } else {
                reject(error);
              }
            },
            reject,
          });
        });
      }

      // Refresh failed — redirect
      if (typeof window !== "undefined") window.location.href = "/login";
      return Promise.reject(error);
    }

    // 403 — let the caller handle it (show permission-denied UI etc.)
    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// Convenience re-export
// ---------------------------------------------------------------------------
export { setAccessToken as setToken };
export default apiClient;
