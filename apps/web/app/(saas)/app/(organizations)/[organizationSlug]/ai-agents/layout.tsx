import { redirect } from "next/navigation";
import { getSession } from "@saas/auth/lib/server";
import { SparklesIcon } from "lucide-react";
import { AiAgentsNav } from "@/modules/smartbeak/ai-agents/components/AiAgentsNav";

interface AiAgentsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}

export default async function AiAgentsLayout({
  children,
  params,
}: AiAgentsLayoutProps) {
  const session = await getSession();
  if (!session) redirect("/auth/login");

  const { organizationSlug } = await params;
  const basePath = `/app/${organizationSlug}/ai-agents`;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-screen-2xl mx-auto">
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

      <AiAgentsNav basePath={basePath} />

      <div className="flex-1">{children}</div>
    </div>
  );
}
