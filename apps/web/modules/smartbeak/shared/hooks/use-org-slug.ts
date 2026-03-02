"use client";
import { useParams } from "next/navigation";

export function useOrgSlug(): string {
  const params = useParams<{ organizationSlug: string }>();
  return params.organizationSlug;
}
