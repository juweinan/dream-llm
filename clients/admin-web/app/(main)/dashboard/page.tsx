"use client";

import { useAuth } from "@/contexts/auth-context";

export default function DashboardPage() {
  const { user } = useAuth();

  const stats = [
    { label: "用户总数", value: "—", color: "bg-blue-50 text-blue-700" },
    { label: "角色总数", value: "—", color: "bg-purple-50 text-purple-700" },
    { label: "权限总数", value: "13", color: "bg-green-50 text-green-700" },
    { label: "审计日志", value: "—", color: "bg-amber-50 text-amber-700" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          欢迎回来，{user?.username}
        </h1>
        <p className="mt-1 text-sm text-slate-500">这是你的后台管理仪表盘</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 bg-white p-6"
          >
            <p className="text-sm text-slate-500">{s.label}</p>
            <p className={`mt-2 text-3xl font-bold ${s.color.split(" ")[1]}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-8">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">快速开始</h3>
        <ul className="space-y-2 text-sm text-slate-600">
          <li>· 在「用户管理」中创建新用户并分配角色</li>
          <li>· 在「角色管理」中创建角色并关联权限</li>
          <li>· 在「权限配置中心」查看系统权限树结构</li>
          <li>· 在「审计日志」中追踪敏感操作记录</li>
        </ul>
      </div>
    </div>
  );
}
