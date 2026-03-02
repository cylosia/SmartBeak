"use client";
import { useParams } from "next/navigation";

export function useDomainId(): string {
  const params = useParams<{ domainId: string }>();
  return params.domainId;
}
