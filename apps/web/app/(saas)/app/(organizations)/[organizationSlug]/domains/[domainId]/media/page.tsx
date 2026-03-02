import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { MediaLibraryView } from "@/modules/smartbeak/media/components/MediaLibraryView";

export default async function MediaPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; domainId: string }>;
}) {
  const { organizationSlug, domainId } = await params;
  const org = await getActiveOrganization(organizationSlug);
  if (!org) return notFound();

  return (
    <div>
      <PageHeader
        title="Media Library"
        subtitle="Upload, manage, and embed media assets for this domain."
      />
      <MediaLibraryView organizationSlug={organizationSlug} domainId={domainId} />
    </div>
  );
}
