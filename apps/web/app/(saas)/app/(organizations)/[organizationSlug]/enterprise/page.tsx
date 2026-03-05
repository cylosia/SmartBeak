import { redirect } from "next/navigation";

export default async function EnterprisePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  redirect(`/app/${organizationSlug}/enterprise/teams`);
}
