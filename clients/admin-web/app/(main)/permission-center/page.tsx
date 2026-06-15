"use client";

import { useState, useEffect } from "react";
import apiClient from "@/lib/api";

interface PermissionNode {
  id: string;
  name: string;
  code: string;
  type: string;
  module: string;
  children?: PermissionNode[];
}

export default function PermissionCenterPage() {
  const [tree, setTree] = useState<PermissionNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiClient.get<PermissionNode[]>("/permissions").then((res) => setTree(res.data));
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderNode = (node: PermissionNode, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-3 rounded-lg px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors ${depth > 0 ? "ml-8" : ""}`}
          onClick={() => hasChildren && toggleExpand(node.id)}
        >
          {hasChildren ? (
            <svg className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          ) : <span className="w-4" />}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-800">{node.name}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${node.type === "PAGE" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                {node.type === "PAGE" ? "页面" : "按钮"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">{node.code}</p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{node.module}</span>
        </div>
        {hasChildren && isExpanded && (
          <div className="border-l-2 border-slate-100 ml-11 pl-4">
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">权限配置中心</h1>
        <p className="mt-1 text-sm text-slate-500">查看系统所有权限的层级结构</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        {tree.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-12">暂无权限数据</p>
        ) : (
          <div className="space-y-1">{tree.map((node) => renderNode(node))}</div>
        )}
      </div>
    </div>
  );
}
