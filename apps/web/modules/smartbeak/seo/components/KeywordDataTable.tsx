"use client";

import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Progress } from "@repo/ui/components/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@repo/ui/components/table";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import {
	ActivityIcon,
	ArrowDownIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	ChevronsUpDownIcon,
	SearchIcon,
	TrashIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import {
	formatVolume,
	generateMockSparkline,
	getDecayHealth,
	getDifficultyTier,
	getPositionTrend,
} from "../lib/seo-utils";

interface KeywordRow {
	id: string;
	keyword: string;
	volume: number | null;
	difficulty: number | null;
	position: number | null;
	decayFactor: string | null;
	lastUpdated: string | Date;
}

function clampPercent(value: number | null | undefined) {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return 0;
	}
	return Math.min(100, Math.max(0, value));
}

function MiniSparkline({ data, id }: { data: number[]; id: string }) {
	const chartData = data.map((v, i) => ({ i, v }));
	const isImproving = data.length > 1 && data[data.length - 1] < data[0];
	const gradientId = `spark-${id}`;

	return (
		<div className="h-5 w-12">
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart
					data={chartData}
					margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
				>
					<defs>
						<linearGradient
							id={gradientId}
							x1="0"
							y1="0"
							x2="0"
							y2="1"
						>
							<stop
								offset="0%"
								stopColor={
									isImproving
										? "hsl(var(--chart-2))"
										: "hsl(var(--chart-5))"
								}
								stopOpacity={0.4}
							/>
							<stop
								offset="100%"
								stopColor={
									isImproving
										? "hsl(var(--chart-2))"
										: "hsl(var(--chart-5))"
								}
								stopOpacity={0}
							/>
						</linearGradient>
					</defs>
					<Area
						type="monotone"
						dataKey="v"
						stroke={
							isImproving
								? "hsl(var(--chart-2))"
								: "hsl(var(--chart-5))"
						}
						strokeWidth={1.5}
						fill={`url(#${gradientId})`}
						dot={false}
						isAnimationActive={false}
					/>
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
}

function SortableHeader({
	label,
	column,
}: {
	label: string;
	column: {
		getIsSorted: () => false | "asc" | "desc";
		toggleSorting: (desc?: boolean) => void;
	};
}) {
	const sorted = column.getIsSorted();
	return (
		<Button
			variant="ghost"
			size="sm"
			className="-ml-3 h-8 font-medium"
			onClick={() => column.toggleSorting(sorted === "asc")}
		>
			{label}
			{sorted === "asc" ? (
				<ArrowUpIcon className="ml-1 h-3.5 w-3.5" />
			) : sorted === "desc" ? (
				<ArrowDownIcon className="ml-1 h-3.5 w-3.5" />
			) : (
				<ChevronsUpDownIcon className="ml-1 h-3.5 w-3.5 text-muted-foreground/50" />
			)}
		</Button>
	);
}

const columns: ColumnDef<KeywordRow>[] = [
	{
		id: "select",
		header: ({ table }) => (
			<Checkbox
				checked={table.getIsAllPageRowsSelected()}
				onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
				aria-label="Select all"
			/>
		),
		cell: ({ row }) => (
			<Checkbox
				checked={row.getIsSelected()}
				onCheckedChange={(v) => row.toggleSelected(!!v)}
				aria-label={`Select ${row.original.keyword}`}
			/>
		),
		enableSorting: false,
		size: 40,
	},
	{
		accessorKey: "keyword",
		header: ({ column }) => (
			<SortableHeader label="Keyword" column={column} />
		),
		cell: ({ row }) => (
			<span className="font-medium">{row.original.keyword}</span>
		),
	},
	{
		accessorKey: "volume",
		header: ({ column }) => (
			<SortableHeader label="Volume" column={column} />
		),
		cell: ({ row }) => (
			<span className="text-sm tabular-nums text-muted-foreground">
				{formatVolume(row.original.volume)}
			</span>
		),
		sortingFn: (a, b) =>
			(a.original.volume ?? 0) - (b.original.volume ?? 0),
	},
	{
		accessorKey: "difficulty",
		header: ({ column }) => (
			<SortableHeader label="Difficulty" column={column} />
		),
		cell: ({ row }) => {
			const d = row.original.difficulty;
			const tier = getDifficultyTier(d);
			const normalizedDifficulty = clampPercent(d);
			if (d == null) {
				return <span className="text-sm text-muted-foreground">—</span>;
			}
			return (
				<div className="flex items-center gap-2">
					<Progress
						value={normalizedDifficulty}
						className="h-1.5 w-14"
					/>
					<span
						className={`text-xs font-medium px-1.5 py-0.5 rounded ${tier.bg} ${tier.color}`}
					>
						{tier.label}
					</span>
				</div>
			);
		},
		sortingFn: (a, b) =>
			(a.original.difficulty ?? 0) - (b.original.difficulty ?? 0),
	},
	{
		accessorKey: "position",
		header: ({ column }) => (
			<SortableHeader label="Position" column={column} />
		),
		cell: ({ row }) => {
			const pos = row.original.position;
			const trend = getPositionTrend(pos);
			if (pos == null) {
				return <span className="text-sm text-muted-foreground">—</span>;
			}
			const TrendIcon =
				trend?.direction === "up"
					? ArrowUpIcon
					: trend?.direction === "down"
						? ArrowDownIcon
						: ArrowRightIcon;
			return (
				<div className="flex items-center gap-1.5">
					<TrendIcon
						className={`h-3.5 w-3.5 ${trend?.color ?? ""}`}
					/>
					<span className="text-sm font-medium tabular-nums">
						#{pos}
					</span>
				</div>
			);
		},
		sortingFn: (a, b) =>
			(a.original.position ?? 999) - (b.original.position ?? 999),
	},
	{
		id: "decay",
		header: ({ column }) => (
			<SortableHeader label="Decay State" column={column} />
		),
		accessorFn: (row) =>
			row.decayFactor ? Number.parseFloat(row.decayFactor) : 0,
		cell: ({ row }) => {
			const health = getDecayHealth(row.original.decayFactor);
			return (
				<div className="flex items-center gap-1.5">
					<ActivityIcon className={`h-3.5 w-3.5 ${health.color}`} />
					<span className={`text-xs font-medium ${health.color}`}>
						{health.label}
					</span>
				</div>
			);
		},
	},
	{
		id: "trend",
		header: "Trend",
		cell: ({ row }) => {
			const sparkData = generateMockSparkline(row.original.position);
			return <MiniSparkline data={sparkData} id={row.original.id} />;
		},
		enableSorting: false,
	},
];

export function KeywordDataTable({
	data,
	onDelete,
	isDeleting,
}: {
	data: KeywordRow[];
	onDelete: (ids: string[]) => Promise<void>;
	isDeleting?: boolean;
}) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [rowSelection, setRowSelection] = useState<Record<string, boolean>>(
		{},
	);

	useEffect(() => {
		const visibleIds = new Set(data.map((row) => row.id));
		setRowSelection((current) => {
			const next = Object.fromEntries(
				Object.entries(current).filter(([id, selected]) => {
					return selected && visibleIds.has(id);
				}),
			);
			return Object.keys(next).length === Object.keys(current).length
				? current
				: next;
		});
	}, [data]);

	const table = useReactTable({
		data,
		columns,
		state: { sorting, globalFilter, rowSelection },
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onRowSelectionChange: setRowSelection,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		enableRowSelection: true,
		getRowId: (row) => row.id,
	});

	const selectedIds = Object.keys(rowSelection).filter(
		(k) => rowSelection[k],
	);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<div className="relative max-w-sm flex-1">
					<SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search keywords..."
						value={globalFilter}
						onChange={(e) => setGlobalFilter(e.target.value)}
						className="pl-9"
					/>
				</div>
				{selectedIds.length > 0 && (
					<Button
						variant="destructive"
						size="sm"
						onClick={async () => {
							try {
								await onDelete(selectedIds);
								setRowSelection({});
							} catch {
								// Keep the selection so the user can retry the failed delete.
							}
						}}
						disabled={isDeleting}
					>
						<TrashIcon className="mr-1.5 h-3.5 w-3.5" />
						Delete {selectedIds.length}
					</Button>
				)}
			</div>

			<div className="rounded-xl border border-border overflow-hidden">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((hg) => (
							<TableRow key={hg.id}>
								{hg.headers.map((header) => (
									<TableHead
										key={header.id}
										style={{
											width:
												header.getSize() !== 150
													? header.getSize()
													: undefined,
										}}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef
														.header,
													header.getContext(),
												)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center text-muted-foreground"
								>
									No keywords match your search.
								</TableCell>
							</TableRow>
						) : (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									data-state={
										row.getIsSelected() && "selected"
									}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<p className="text-xs text-muted-foreground">
				{table.getFilteredRowModel().rows.length} keyword
				{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}{" "}
				tracked
			</p>
		</div>
	);
}
