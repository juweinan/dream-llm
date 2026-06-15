"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { apiClient, setAccessToken } from "@/lib/api";

interface User {
  id: string;
  username: string;
  isSuperAdmin: boolean;
  status: string;
}

interface MenuItem {
  label: string;
  href: string;
  permission: string;
  icon: string;
}

export const menuItems: MenuItem[] = [
  { label: "仪表盘", href: "/dashboard", permission: "dashboard:page:view", icon: "LayoutDashboard" },
  { label: "用户管理", href: "/users", permission: "user:page:view", icon: "Users" },
  { label: "角色管理", href: "/roles", permission: "role:page:view", icon: "Shield" },
  { label: "权限配置中心", href: "/permission-center", permission: "permission:page:view", icon: "Key" },
  { label: "审计日志", href: "/audit-logs", permission: "audit:page:view", icon: "ScrollText" },
];

interface AuthState {
  user: User | null;
  permissions: Set<string>;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  permissions: new Set(),
  loading: true,
  login: async () => {},
  logout: async () => {},
  hasPermission: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // On mount: try refresh → fetch profile
  useEffect(() => {
    (async () => {
      try {
        const refreshRes = await apiClient.post<{ accessToken: string }>("/auth/refresh");
        const { accessToken } = refreshRes.data;
        setAccessToken(accessToken);
        const meRes = await apiClient.get<{ user: User; permissions: string[] }>("/account/me");
        setUser(meRes.data.user);
        setPermissions(new Set(meRes.data.permissions));
      } catch {
        // refresh failed — AuthGuard will redirect to /login
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiClient.post<{ accessToken: string }>("/auth/login", {
      username,
      password,
    });
    setAccessToken(res.data.accessToken);
    const meRes = await apiClient.get<{ user: User; permissions: string[] }>("/account/me");
    setUser(meRes.data.user);
    setPermissions(new Set(meRes.data.permissions));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.post("/auth/logout");
    } catch {
      // ignore
    }
    setAccessToken(null);
    setUser(null);
    setPermissions(new Set());
    window.location.href = "/login";
  }, []);

  const hasPermission = useCallback(
    (code: string) => user?.isSuperAdmin || permissions.has(code),
    [user, permissions],
  );

  return (
    <AuthContext.Provider value={{ user, permissions, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
