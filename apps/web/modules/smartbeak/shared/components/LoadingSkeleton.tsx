import { Skeleton } from "@repo/ui/components/skeleton";

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
	return (
		<div className="space-y-3">
			<Skeleton className="h-10 w-full" />
			{Array.from({ length: rows }).map((_, i) => (
				<Skeleton key={i} className="h-14 w-full" />
			))}
		</div>
	);
}

export function CardGridSkeleton({
	count = 4,
	cols = 4,
}: {
	count?: number;
	cols?: 2 | 3 | 4 | 5;
}) {
	const colClass =
		cols === 2
			? "sm:grid-cols-2"
			: cols === 3
				? "sm:grid-cols-2 lg:grid-cols-3"
				: cols === 5
					? "sm:grid-cols-2 lg:grid-cols-5"
					: "sm:grid-cols-2 lg:grid-cols-4";
	return (
		<div className={`grid grid-cols-1 gap-4 ${colClass}`}>
			{Array.from({ length: count }).map((_, i) => (
				<Skeleton key={i} className="h-32 w-full rounded-xl" />
			))}
		</div>
	);
}

export function PageSkeleton() {
	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-4 w-96" />
			</div>
			<CardGridSkeleton count={4} />
			<TableSkeleton rows={6} />
		</div>
	);
}
