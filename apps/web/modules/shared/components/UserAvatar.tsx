import { config as storageConfig } from "@repo/storage/config";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@repo/ui/components/avatar";
import { useMemo } from "react";

function getAvatarSrc(avatarUrl?: string | null) {
	if (!avatarUrl) {
		return undefined;
	}

	const normalizedAvatarUrl = avatarUrl.trim();
	if (!normalizedAvatarUrl) {
		return undefined;
	}

	try {
		const externalUrl = new URL(normalizedAvatarUrl);
		if (
			externalUrl.protocol === "http:" ||
			externalUrl.protocol === "https:"
		) {
			return externalUrl.toString();
		}
	} catch {
		// Fall through to treat non-URL values as storage object paths.
	}

	const encodedObjectPath = normalizedAvatarUrl
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");

	return encodedObjectPath
		? `/image-proxy/${storageConfig.bucketNames.avatars}/${encodedObjectPath}`
		: undefined;
}

export const UserAvatar = ({
	name,
	avatarUrl,
	className,
	ref,
}: React.ComponentProps<typeof Avatar> & {
	name: string;
	avatarUrl?: string | null;
	className?: string;
}) => {
	const initials = useMemo(
		() =>
			name
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((n) => n[0])
				.join(""),
		[name],
	);

	const avatarSrc = useMemo(() => getAvatarSrc(avatarUrl), [avatarUrl]);

	return (
		<Avatar ref={ref} className={className}>
			<AvatarImage src={avatarSrc} />
			<AvatarFallback className="bg-primary/10 text-primary">
				{initials}
			</AvatarFallback>
		</Avatar>
	);
};

UserAvatar.displayName = "UserAvatar";
