"use client";
import { useParams } from "next/navigation";

export function useOrgSlug(): string {
  const params = useParams<{ organizationSlug: string }>();
  if (!params.organizationSlug) {
    throw new Error("useOrgSlug must be used within a route containing [organizationSlug]");
  }
  return params.organizationSlug;
}
