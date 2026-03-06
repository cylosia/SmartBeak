import { Skeleton } from "@repo/ui/components/skeleton";

export default function AppLoading() {
	return (
		<div className="flex flex-col gap-6 p-6">
			<div className="flex items-center justify-between">
				<div className="space-y-2">
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-4 w-72" />
				</div>
				<Skeleton className="h-9 w-28" />
			</div>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<Skeleton key={i} className="h-32 rounded-xl" />
				))}
			</div>
			<Skeleton className="h-64 rounded-xl" />
		</div>
	);
}
