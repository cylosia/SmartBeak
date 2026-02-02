import { cn } from "@repo/ui";
import { NavBar } from "@saas/shared/components/NavBar";
import type { PropsWithChildren } from "react";
import { config } from "@/config";

export function AppWrapper({ children }: PropsWithChildren) {
	return (
		<div className="bg-muted">
			<NavBar />
			<div
				className={cn("md:pr-4 py-4 flex", [
					config.saas.useSidebarLayout
						? "min-h-[calc(100vh)] md:ml-[280px]"
						: "",
				])}
			>
				<main
					className={cn(
						"py-6 rounded-3xl bg-background px-4 md:p-8 min-h-full w-full",
					)}
				>
					<div className="container px-0">{children}</div>
				</main>
			</div>
		</div>
	);
}
