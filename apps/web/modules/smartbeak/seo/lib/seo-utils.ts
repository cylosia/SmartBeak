function normalizeFiniteNumber(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNonNegativeNumber(value: number | null | undefined) {
	const normalized = normalizeFiniteNumber(value);
	return normalized == null ? null : Math.max(0, normalized);
}

export function getDifficultyTier(difficulty: number | null | undefined) {
	const normalizedDifficulty = normalizeNonNegativeNumber(difficulty);
	if (normalizedDifficulty == null) {
		return {
			label: "Unknown",
			color: "text-muted-foreground",
			bg: "bg-muted",
		};
	}
	if (normalizedDifficulty < 30) {
		return {
			label: "Easy",
			color: "text-emerald-600 dark:text-emerald-400",
			bg: "bg-emerald-100 dark:bg-emerald-900/30",
		};
	}
	if (normalizedDifficulty < 70) {
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
	const normalizedPosition = normalizeNonNegativeNumber(position);
	if (normalizedPosition == null) {
		return null;
	}
	if (normalizedPosition <= 10) {
		return {
			direction: "up" as const,
			color: "text-emerald-600 dark:text-emerald-400",
		};
	}
	if (normalizedPosition <= 30) {
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
			label: "Low Decay",
			color: "text-emerald-600 dark:text-emerald-400",
			level: 1,
		};
	}
	if (value < 0.7) {
		return {
			label: "Watch",
			color: "text-amber-600 dark:text-amber-400",
			level: 2,
		};
	}
	return {
		label: "Elevated Decay",
		color: "text-red-600 dark:text-red-400",
		level: 3,
	};
}

export function formatVolume(volume: number | null | undefined): string {
	const normalizedVolume = normalizeNonNegativeNumber(volume);
	if (normalizedVolume == null) {
		return "—";
	}
	if (normalizedVolume >= 1_000_000) {
		return `${(normalizedVolume / 1_000_000).toFixed(1)}M`;
	}
	if (normalizedVolume >= 1_000) {
		return `${(normalizedVolume / 1_000).toFixed(1)}K`;
	}
	return normalizedVolume.toLocaleString();
}

export function generateMockSparkline(
	position: number | null | undefined,
	points = 7,
): number[] {
	const safePoints =
		typeof points === "number" && Number.isFinite(points) && points > 0
			? Math.floor(points)
			: 7;
	const base = normalizeNonNegativeNumber(position) ?? 50;
	return Array.from({ length: safePoints }, (_, i) => {
		const noise = Math.sin(i * 1.5) * 8 + Math.cos(i * 0.7) * 5;
		return Math.max(1, Math.round(base + noise - i * 0.5));
	});
}
