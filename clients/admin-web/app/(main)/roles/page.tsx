"use client";

import { useState, useEffect, useCallback } from "react";
import apiClient from "@/lib/api";
import { PermissionButton } from "@/components/auth/PermissionButton";

interface RoleItem {
  id: string;
  name: string;
  code: string;
  description: string | null;
  _count: { userRoles: number; rolePermissions: number };
}

interface Permission {
  id: string;
  name: string;
  code: string;
  type: string;
  module: string;
  children?: Permission[];
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: "create" | "edit" | "permissions";
    role?: RoleItem;
  }>({ open: false, mode: "create" });
  const [form, setForm] = useState({ name: "", code: "", description: "" });
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPermIds, setSelectedPermIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await apiClient.get<RoleItem[]>("/roles");
    setRoles(res.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ name: "", code: "", description: "" });
    setDrawer({ open: true, mode: "create" });
  };

  const openEdit = (r: RoleItem) => {
    setForm({ name: r.name, code: r.code, description: r.description || "" });
    setDrawer({ open: true, mode: "edit", role: r });
  };

  const openPermissions = async (r: RoleItem) => {
    try {
      const [treeRes, detailRes] = await Promise.all([
        apiClient.get<Permission[]>("/permissions"),
        apiClient.get<{ rolePermissions: { permission: { id: string } }[] }>(`/roles/${r.id}`),
      ]);
      setPermissions(treeRes?.data ?? []);
      setSelectedPermIds((detailRes?.data?.rolePermissions ?? []).map((rp) => rp.permission.id));
      setDrawer({ open: true, mode: "permissions", role: r });
    } catch {
      setPermissions([]);
      setSelectedPermIds([]);
      setDrawer({ open: true, mode: "permissions", role: r });
    }
  };

  const handleSave = async () => {
    if (drawer.mode === "create") {
      await apiClient.post("/roles", form);
    } else if (drawer.mode === "edit" && drawer.role) {
      await apiClient.patch(`/roles/${drawer.role.id}`, { name: form.name, description: form.description });
    }
    setDrawer({ open: false, mode: "create" });
    load();
  };

  const handleAssignPermissions = async () => {
    if (!drawer.role) return;
    await apiClient.patch(`/roles/${drawer.role.id}/permissions`, { permissionIds: selectedPermIds });
    setDrawer({ open: false, mode: "create" });
    load();
  };

  const togglePerm = (id: string) => {
    setSelectedPermIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const renderPermTree = (nodes: Permission[], depth = 0) => (
    <div className={depth > 0 ? "ml-6 mt-2" : "space-y-2"}>
      {nodes.map((perm) => (
        <div key={perm.id}>
          <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedPermIds.includes(perm.id)}
              onChange={() => togglePerm(perm.id)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">{perm.name}</span>
              <span className="ml-2 text-xs text-slate-400">
                {perm.code} · {perm.type === "PAGE" ? "页面" : "按钮"}
              </span>
            </div>
          </label>
          {perm.children?.length ? renderPermTree(perm.children, depth + 1) : null}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">角色管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {roles.length} 个角色</p>
        </div>
        <PermissionButton
          code="role:button:create"
          onClick={openCreate}
          className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors"
        >
          新建角色
        </PermissionButton>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-6 py-3">角色名</th>
              <th className="px-6 py-3">Code</th>
              <th className="px-6 py-3">用户数</th>
              <th className="px-6 py-3">权限数</th>
              <th className="px-6 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roles.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-3.5 font-medium text-slate-900">{r.name}</td>
                <td className="px-6 py-3.5 font-mono text-xs text-slate-500">{r.code}</td>
                <td className="px-6 py-3.5 text-slate-600">{r._count.userRoles}</td>
                <td className="px-6 py-3.5 text-slate-600">{r._count.rolePermissions}</td>
                <td className="px-6 py-3.5 text-right">
                  <div className="flex justify-end gap-2">
                    <PermissionButton
                      code="role:button:edit"
                      onClick={() => openEdit(r)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      编辑
                    </PermissionButton>
                    <PermissionButton
                      code="role:button:assign-permission"
                      onClick={() => openPermissions(r)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors"
                    >
                      分配权限
                    </PermissionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawer.open && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawer({ open: false, mode: "create" })} />
          <div className="fixed right-0 top-0 h-full w-[520px] bg-white z-50 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between border-b px-6 py-4 sticky top-0 bg-white z-10">
              <h3 className="text-lg font-semibold text-slate-900">
                {drawer.mode === "permissions"
                  ? `分配权限 — ${drawer.role?.name}`
                  : drawer.mode === "edit" ? "编辑角色" : "新建角色"}
              </h3>
              <button onClick={() => setDrawer({ open: false, mode: "create" })} className="rounded-lg p-1 hover:bg-slate-100 text-slate-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {drawer.mode === "permissions" ? (
                <>
                  <p className="text-sm text-slate-500">勾选要授予此角色的权限（支持父子层级）：</p>
                  {renderPermTree(permissions)}
                  <button onClick={handleAssignPermissions} className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors sticky bottom-4">
                    保存权限分配
                  </button>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">角色名称</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Code</label>
                    <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                      disabled={drawer.mode === "edit"}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">描述</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none" />
                  </div>
                  <button onClick={handleSave} className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors">
                    {drawer.mode === "create" ? "创建角色" : "保存修改"}
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
