"use client";
import { Button } from "@repo/ui/components/button";
import { AlertTriangleIcon } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

function reportErrorToServer(error: Error, componentStack?: string | null) {
	try {
		void fetch("/api/client-error", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				message: error.message,
				stack: error.stack?.slice(0, 2000),
				componentStack: componentStack?.slice(0, 2000),
			}),
		}).catch(() => {});
	} catch {
		// Silently fail — error reporting should never throw
	}
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		reportErrorToServer(error, errorInfo.componentStack);
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}
			return (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
						<AlertTriangleIcon className="h-7 w-7 text-destructive" />
					</div>
					<h3 className="text-base font-semibold">
						Something went wrong
					</h3>
					<p className="mt-1 max-w-sm text-sm text-muted-foreground">
						An unexpected error occurred. Please try again.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-6"
						aria-label="Try again"
						onClick={() =>
							this.setState({ hasError: false, error: undefined })
						}
					>
						Try again
					</Button>
				</div>
			);
		}
		return this.props.children;
	}
}
