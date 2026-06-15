"use client";

import { useAuth, menuItems } from "@/contexts/auth-context";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Inline SVG icons
function SidebarIcon({ active }: { active: boolean }) {
  const color = active ? "text-blue-600" : "text-slate-400";
  return (
    <svg className={`h-5 w-5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

export function Sidebar() {
  const { user, hasPermission, logout } = useAuth();
  const pathname = usePathname();

  const visibleItems = menuItems.filter((item) => hasPermission(item.permission));

  return (
    <aside className="flex h-full w-[272px] flex-col bg-slate-900 text-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-slate-700/50">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold">
          R
        </div>
        <span className="text-lg font-semibold tracking-tight">RBAC Admin</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <SidebarIcon active={isActive} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-slate-700/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-medium">
            {user?.username?.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-white">{user?.username}</p>
            <p className="truncate text-xs text-slate-400">
              {user?.isSuperAdmin ? "Super Admin" : "User"}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="mt-3 w-full rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          退出登录
        </button>
      </div>
    </aside>
  );
}
