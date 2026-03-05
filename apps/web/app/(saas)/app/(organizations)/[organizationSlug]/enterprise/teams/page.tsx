import { TeamManagementDashboard } from "@/modules/smartbeak/enterprise/teams/components/TeamManagementDashboard";

export async function generateMetadata() {
  return { title: "Team Workspaces — Enterprise" };
}

export default async function EnterpriseTeamsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  return <TeamManagementDashboard organizationSlug={organizationSlug} />;
}
