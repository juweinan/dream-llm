"use client";

import { useAuth } from "@/contexts/auth-context";

export default function ProfilePage() {
  const { user, permissions } = useAuth();

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">个人信息</h1>
        <p className="mt-1 text-sm text-slate-500">查看当前账户信息与权限</p>
      </div>

      {/* User Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-8 mb-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-700 text-xl font-bold text-white">
            {user?.username?.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{user?.username}</h2>
            <div className="flex gap-2 mt-1">
              {user?.isSuperAdmin && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Super Admin
                </span>
              )}
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  user?.status === "ACTIVE"
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {user?.status === "ACTIVE" ? "正常" : "已禁用"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg bg-slate-50 p-4">
            <span className="text-slate-500">用户 ID</span>
            <p className="mt-1 font-mono text-xs text-slate-700 break-all">{user?.id}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <span className="text-slate-500">用户名</span>
            <p className="mt-1 font-medium text-slate-900">{user?.username}</p>
          </div>
        </div>
      </div>

      {/* Permissions */}
      <div className="rounded-xl border border-slate-200 bg-white p-8">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">权限列表</h3>
        {permissions.size === 0 ? (
          <p className="text-sm text-slate-400">暂无权限</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[...permissions].sort().map((code) => (
              <span
                key={code}
                className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
              >
                {code}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
