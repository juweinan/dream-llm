"use client";

import { useAuth } from "@/contexts/auth-context";

export function PermissionButton({
  code,
  children,
  className,
  onClick,
  ...rest
}: {
  code: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const { hasPermission } = useAuth();
  if (!hasPermission(code)) return null;

  return (
    <button
      onClick={onClick}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}
