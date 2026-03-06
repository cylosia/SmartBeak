export function getDifficultyTier(difficulty: number | null | undefined) {
	if (difficulty == null) {
		return {
			label: "Unknown",
			color: "text-muted-foreground",
			bg: "bg-muted",
		};
	}
	if (difficulty < 30) {
		return {
			label: "Easy",
			color: "text-emerald-600 dark:text-emerald-400",
			bg: "bg-emerald-100 dark:bg-emerald-900/30",
		};
	}
	if (difficulty < 70) {
		return {
			label: "Medium",
			color: "text-amber-600 dark:text-amber-400",
			bg: "bg-amber-100 dark:bg-amber-900/30",
		};
	}
	return {
		label: "Hard",
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-100 dark:bg-red-900/30",
	};
}

export function getPositionTrend(position: number | null | undefined) {
	if (position == null) {
		return null;
	}
	if (position <= 10) {
		return {
			direction: "up" as const,
			color: "text-emerald-600 dark:text-emerald-400",
		};
	}
	if (position <= 30) {
		return {
			direction: "neutral" as const,
			color: "text-amber-600 dark:text-amber-400",
		};
	}
	return {
		direction: "down" as const,
		color: "text-red-600 dark:text-red-400",
	};
}

export function getDecayHealth(decayFactor: string | null | undefined) {
	const value = decayFactor ? Number.parseFloat(decayFactor) : null;
	if (value == null || Number.isNaN(value)) {
		return { label: "N/A", color: "text-muted-foreground", level: 0 };
	}
	if (value < 0.3) {
		return {
			label: "Healthy",
			color: "text-emerald-600 dark:text-emerald-400",
			level: 1,
		};
	}
	if (value < 0.7) {
		return {
			label: "Warning",
			color: "text-amber-600 dark:text-amber-400",
			level: 2,
		};
	}
	return {
		label: "Declining",
		color: "text-red-600 dark:text-red-400",
		level: 3,
	};
}

export function formatVolume(volume: number | null | undefined): string {
	if (volume == null) {
		return "—";
	}
	if (volume >= 1_000_000) {
		return `${(volume / 1_000_000).toFixed(1)}M`;
	}
	if (volume >= 1_000) {
		return `${(volume / 1_000).toFixed(1)}K`;
	}
	return volume.toLocaleString();
}

export function generateMockSparkline(
	position: number | null | undefined,
	points = 7,
): number[] {
	const base = position ?? 50;
	return Array.from({ length: points }, (_, i) => {
		const noise = Math.sin(i * 1.5) * 8 + Math.cos(i * 0.7) * 5;
		return Math.max(1, Math.round(base + noise - i * 0.5));
	});
}
