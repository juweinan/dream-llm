"use client";

import { useState, useEffect, useCallback } from "react";
import apiClient from "@/lib/api";
import { PermissionButton } from "@/components/auth/PermissionButton";

interface UserItem {
  id: string;
  username: string;
  isSuperAdmin: boolean;
  status: string;
  createdAt: string;
  userRoles: { role: { id: string; name: string } }[];
}

interface RoleItem {
  id: string;
  name: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState<{ open: boolean; mode: "create" | "edit" | "assign-roles"; user?: UserItem }>({ open: false, mode: "create" });
  const [form, setForm] = useState({ username: "", password: "" });
  const [rolesForAssign, setRolesForAssign] = useState<RoleItem[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await apiClient.get<{ items: UserItem[]; total: number }>(
      `/users?page=${page}&limit=20`,
    );
    setUsers(res.data.items);
    setTotal(res.data.total);
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) => search ? u.username.includes(search) : true);

  const openCreate = () => { setForm({ username: "", password: "" }); setDrawer({ open: true, mode: "create" }); };
  const openEdit = (u: UserItem) => { setForm({ username: u.username, password: "" }); setDrawer({ open: true, mode: "edit", user: u }); };

  const openAssignRoles = async (u: UserItem) => {
    try {
      const rolesRes = await apiClient.get<RoleItem[]>("/roles");
      setRolesForAssign(rolesRes?.data ?? []);
      setSelectedRoleIds((u.userRoles ?? []).map((ur) => ur.role.id));
      setDrawer({ open: true, mode: "assign-roles", user: u });
    } catch {
      // 加载角色失败时静默处理，展示空列表
      setRolesForAssign([]);
      setSelectedRoleIds([]);
      setDrawer({ open: true, mode: "assign-roles", user: u });
    }
  };

  const handleSave = async () => {
    if (drawer.user) {
      await apiClient.patch(`/users/${drawer.user.id}`, form);
    } else {
      await apiClient.post("/users", form);
    }
    setDrawer({ open: false, mode: "create" });
    load();
  };

  const handleAssignRoles = async () => {
    if (!drawer.user) return;
    await apiClient.patch(`/users/${drawer.user.id}/roles`, { roleIds: selectedRoleIds });
    setDrawer({ open: false, mode: "create" });
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">用户管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 个用户</p>
        </div>
        <PermissionButton code="user:button:create" onClick={openCreate}
          className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors">
          新建用户
        </PermissionButton>
      </div>

      <div className="mb-4">
        <input type="text" placeholder="搜索用户..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-6 py-3">用户名</th>
              <th className="px-6 py-3">角色</th>
              <th className="px-6 py-3">状态</th>
              <th className="px-6 py-3">创建时间</th>
              <th className="px-6 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-3.5 font-medium text-slate-900">
                  {u.username}
                  {u.isSuperAdmin && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Super</span>}
                </td>
                <td className="px-6 py-3.5 text-slate-600">
                  {(u.userRoles ?? []).map((ur) => ur.role.name).join(", ") || <span className="text-slate-400">未分配</span>}
                </td>
                <td className="px-6 py-3.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${u.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{u.status === "ACTIVE" ? "正常" : "已禁用"}</span>
                </td>
                <td className="px-6 py-3.5 text-slate-500">{new Date(u.createdAt).toLocaleDateString("zh-CN")}</td>
                <td className="px-6 py-3.5 text-right">
                  <div className="flex justify-end gap-2">
                    <PermissionButton code="user:button:edit" onClick={() => openEdit(u)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors">编辑</PermissionButton>
                    <PermissionButton code="user:button:assign-role" onClick={() => openAssignRoles(u)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors">分配角色</PermissionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
          <span className="text-xs text-slate-500">第 {page} 页，共 {Math.ceil(total / 20)} 页</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30">上一页</button>
            <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30">下一页</button>
          </div>
        </div>
      </div>

      {drawer.open && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawer({ open: false, mode: "create" })} />
          <div className="fixed right-0 top-0 h-full w-[480px] bg-white z-50 shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">
                {drawer.mode === "assign-roles" ? "分配角色" : drawer.mode === "edit" ? "编辑用户" : "新建用户"}
              </h3>
              <button onClick={() => setDrawer({ open: false, mode: "create" })} className="rounded-lg p-1 hover:bg-slate-100 text-slate-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {drawer.mode === "assign-roles" ? (
                <>
                  <p className="text-sm text-slate-500">为用户 <strong>{drawer.user?.username}</strong> 选择角色：</p>
                  {(rolesForAssign ?? []).map((role) => (
                    <label key={role.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={selectedRoleIds.includes(role.id)}
                        onChange={(e) => setSelectedRoleIds(e.target.checked ? [...selectedRoleIds, role.id] : selectedRoleIds.filter((id) => id !== role.id))}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-sm font-medium text-slate-700">{role.name}</span>
                    </label>
                  ))}
                  <button onClick={handleAssignRoles} className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors">
                    保存角色分配
                  </button>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">用户名</label>
                    <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{drawer.user ? "新密码（留空不修改）" : "密码"}</label>
                    <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none" />
                  </div>
                  <button onClick={handleSave} className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors">
                    {drawer.user ? "保存修改" : "创建用户"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
