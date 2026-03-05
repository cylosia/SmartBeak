import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@repo/auth";
import { headers } from "next/headers";
import {
  ActivityIcon,
  BotIcon,
  LayoutIcon,
  SparklesIcon,
} from "lucide-react";
import { cn } from "@repo/ui/lib/utils";

interface AiAgentsLayoutProps {
  children: React.ReactNode;
  params: { organizationSlug: string };
}

const NAV_ITEMS = [
  {
    label: "Agents",
    href: "ai-agents",
    icon: BotIcon,
    description: "Manage your AI agents",
  },
  {
    label: "Workflows",
    href: "ai-agents/workflows",
    icon: LayoutIcon,
    description: "Build and run workflows",
  },
  {
    label: "Sessions",
    href: "ai-agents/sessions",
    icon: SparklesIcon,
    description: "View execution history",
  },
  {
    label: "Analytics",
    href: "ai-agents/analytics",
    icon: ActivityIcon,
    description: "Usage and cost metrics",
  },
];

export default async function AiAgentsLayout({
  children,
  params,
}: AiAgentsLayoutProps) {
  const session = await auth.api.getSession({ headers: headers() });
  if (!session) redirect("/auth/sign-in");

  const { organizationSlug } = params;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-screen-2xl mx-auto">
      {/* Section Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <SparklesIcon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Agents</h1>
          <p className="text-sm text-muted-foreground">
            Multi-agent workflows, long-context memory, and AI co-pilot
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="flex gap-1 border-b pb-0">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const href = `/app/${organizationSlug}/${item.href}`;
          return (
            <Link
              key={item.href}
              href={href}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border border-transparent transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                "data-[active]:border-border data-[active]:border-b-background data-[active]:text-foreground data-[active]:bg-background",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Page Content */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
