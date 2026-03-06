import { Skeleton } from "@repo/ui/components/skeleton";

export default function AccountLoading() {
	return (
		<div className="flex flex-col gap-6 p-6">
			<Skeleton className="h-8 w-40" />
			<div className="space-y-4">
				{Array.from({ length: 3 }).map((_, i) => (
					<Skeleton key={i} className="h-20 rounded-xl" />
				))}
			</div>
		</div>
	);
}
