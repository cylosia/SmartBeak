"use client";

import { Button } from "@repo/ui/components/button";
import { AlertTriangleIcon } from "lucide-react";

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
			<AlertTriangleIcon className="size-12 text-destructive opacity-60" />
			<div>
				<h2 className="text-xl font-semibold">Something went wrong</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					An unexpected error occurred. Please try again.
				</p>
			</div>
			<Button variant="outline" onClick={reset}>
				Try Again
			</Button>
		</div>
	);
}
