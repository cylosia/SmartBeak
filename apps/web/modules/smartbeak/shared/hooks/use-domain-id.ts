"use client";
import { useParams } from "next/navigation";

export function useDomainId(): string {
	const params = useParams<{ domainId: string }>();
	if (!params.domainId) {
		throw new Error(
			"useDomainId must be used within a route containing [domainId]",
		);
	}
	return params.domainId;
}
