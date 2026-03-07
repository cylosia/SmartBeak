import { notFound, redirect } from "next/navigation";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export default async function EnterprisePage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	if (!SLUG_PATTERN.test(organizationSlug)) {
		notFound();
	}
	redirect(`/app/${organizationSlug}/enterprise/teams`);
}
