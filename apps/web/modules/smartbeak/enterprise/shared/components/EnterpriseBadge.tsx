"use client";

import { Badge } from "@repo/ui/components/badge";
import { LockIcon, ShieldCheckIcon, ZapIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";

interface EnterpriseBadgeProps {
  variant?: "enterprise" | "pro" | "locked";
  className?: string;
}

/**
 * Visual indicator for enterprise-only features.
 * Shown in the UI to clearly communicate tier requirements.
 */
export function EnterpriseBadge({
  variant = "enterprise",
  className,
}: EnterpriseBadgeProps) {
  if (variant === "locked") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 text-muted-foreground border-muted-foreground/30",
          className,
        )}
      >
        <LockIcon className="size-3" />
        Locked
      </Badge>
    );
  }

  if (variant === "pro") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 text-violet-600 border-violet-300 bg-violet-50 dark:bg-violet-950/30",
          className,
        )}
      >
        <ZapIcon className="size-3" />
        Pro
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-950/30",
        className,
      )}
    >
      <ShieldCheckIcon className="size-3" />
      Enterprise
    </Badge>
  );
}

interface EnterpriseGateProps {
  feature: string;
  hasAccess: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Wraps enterprise-only UI sections. When `hasAccess` is false,
 * renders a locked overlay with an upgrade prompt instead.
 */
export function EnterpriseGate({
  feature,
  hasAccess,
  children,
  fallback,
}: EnterpriseGateProps) {
  if (hasAccess) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <div className="relative rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-8">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/80 backdrop-blur-sm">
        <LockIcon className="size-8 text-muted-foreground" />
        <div className="text-center">
          <p className="font-semibold text-sm">Enterprise Feature</p>
          <p className="text-xs text-muted-foreground mt-1">
            {feature} requires an Enterprise plan.
          </p>
        </div>
        <EnterpriseBadge />
      </div>
      <div className="pointer-events-none select-none opacity-30">{children}</div>
    </div>
  );
}
