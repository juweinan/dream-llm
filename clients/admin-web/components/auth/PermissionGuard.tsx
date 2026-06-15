"use client";

import { useAuth } from "@/contexts/auth-context";

export function PermissionGuard({
  code,
  children,
}: {
  code: string;
  children: React.ReactNode;
}) {
  const { hasPermission } = useAuth();
  if (!hasPermission(code)) return null;
  return <>{children}</>;
}
