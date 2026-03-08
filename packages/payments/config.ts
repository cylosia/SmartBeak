function requirePublicEnv(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(
			`Missing required environment variable: ${name}. ` +
				"Ensure it is set in your .env file or hosting provider.",
		);
	}

	return value;
}

export const config = {
	billingAttachedTo: "user" as "user" | "organization", // 'users' or 'organizations'
	plans: {
		// The free plan is treated differently. It will automatically be assigned if the user has no other plan.
		free: {
			isFree: true,
		},
		pro: {
			recommended: true,
			prices: [
				{
					type: "recurring",
					productId: requirePublicEnv(
						"NEXT_PUBLIC_PRICE_ID_PRO_MONTHLY",
						process.env.NEXT_PUBLIC_PRICE_ID_PRO_MONTHLY,
					),
					interval: "month",
					amount: 29,
					currency: "USD",
					seatBased: true,
					trialPeriodDays: 7,
				},
				{
					type: "recurring",
					productId: requirePublicEnv(
						"NEXT_PUBLIC_PRICE_ID_PRO_YEARLY",
						process.env.NEXT_PUBLIC_PRICE_ID_PRO_YEARLY,
					),
					interval: "year",
					amount: 290,
					currency: "USD",
					seatBased: true,
					trialPeriodDays: 7,
				},
			],
		},
		lifetime: {
			prices: [
				{
					type: "one-time",
					productId: requirePublicEnv(
						"NEXT_PUBLIC_PRICE_ID_LIFETIME",
						process.env.NEXT_PUBLIC_PRICE_ID_LIFETIME,
					),
					amount: 799,
					currency: "USD",
				},
			],
		},
		enterprise: {
			isEnterprise: true,
		},
	},
} as const;
