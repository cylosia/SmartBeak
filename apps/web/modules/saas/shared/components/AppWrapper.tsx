import { cn } from "@repo/ui";
import { NavBar } from "@saas/shared/components/NavBar";
import type { PropsWithChildren } from "react";
import { config } from "@/config";

export function AppWrapper({ children }: PropsWithChildren) {
	return (
		<div className="bg-background">
			<NavBar />
			<div
				className={cn("flex", [
					config.saas.useSidebarLayout
						? "min-h-[calc(100vh)] md:ml-[280px]"
						: "",
				])}
			>
				<main
					className={cn(
						"py-6 bg-card px-4 md:p-8 min-h-full w-full border-t md:border-t-0 md:border-l",
					)}
				>
					<div className="container px-0 h-full">{children}</div>
				</main>
			</div>
		</div>
	);
}
