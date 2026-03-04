"use client";

import { Button } from "@repo/ui/components/button";
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangleIcon className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="font-bold text-2xl">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">
        An unexpected error occurred. Please try again or contact support if the
        problem persists.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}
      <Button onClick={reset} variant="outline">
        <RefreshCwIcon className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
