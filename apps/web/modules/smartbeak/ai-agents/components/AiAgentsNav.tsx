"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  BotIcon,
  LayoutIcon,
  SparklesIcon,
} from "lucide-react";
import { cn } from "@repo/ui";

const NAV_ITEMS = [
  { label: "Agents", segment: "", icon: BotIcon },
  { label: "Workflows", segment: "/workflows", icon: LayoutIcon },
  { label: "Sessions", segment: "/sessions", icon: SparklesIcon },
  { label: "Analytics", segment: "/analytics", icon: ActivityIcon },
];

interface AiAgentsNavProps {
  basePath: string;
}

export function AiAgentsNav({ basePath }: AiAgentsNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b pb-0">
      {NAV_ITEMS.map((item) => {
        const href = `${basePath}${item.segment}`;
        const isActive =
          item.segment === ""
            ? pathname === basePath || pathname === `${basePath}/`
            : pathname.startsWith(href);
        const Icon = item.icon;

        return (
          <Link
            key={item.segment}
            href={href}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border border-transparent transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              isActive &&
                "border-border border-b-background text-foreground bg-background",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
