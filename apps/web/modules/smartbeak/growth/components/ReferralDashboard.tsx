"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Skeleton } from "@repo/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@repo/ui/components/table";
import { useSession } from "@saas/auth/hooks/use-session";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon, GiftIcon, TrendingUpIcon, UsersIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ReferralDashboard() {
	const { user } = useSession();
	const [copied, setCopied] = useState(false);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => () => clearTimeout(copyTimerRef.current), []);

	const { data, isLoading, error, refetch } = useQuery(
		orpc.smartbeak.growth.getMyReferrals.queryOptions({
			input: { email: user?.email ?? "" },
			enabled: !!user?.email,
		}),
	);

	const copyLink = () => {
		if (data?.referralLink) {
			navigator.clipboard.writeText(data.referralLink);
			setCopied(true);
			clearTimeout(copyTimerRef.current);
			copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
		}
	};

	if (error) {
		return (
			<Alert variant="error">
				<AlertDescription>
					Failed to load referral data. Please try again.
				</AlertDescription>
				<Button
					variant="outline"
					size="sm"
					onClick={() => refetch()}
					className="mt-2"
				>
					Try Again
				</Button>
			</Alert>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-foreground">
					Referral Program
				</h1>
				<p className="text-foreground/60 mt-1">
					Invite friends and earn rewards — extra credits, domains,
					and more.
				</p>
			</div>

			{/* Stats */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				{isLoading ? (
					Array.from({ length: 3 }).map((_, i) => (
						<Card key={i}>
							<CardContent className="pt-6">
								<Skeleton className="h-8 w-16 mb-2" />
								<Skeleton className="h-4 w-24" />
							</CardContent>
						</Card>
					))
				) : (
					<>
						<Card>
							<CardContent className="pt-6">
								<div className="flex items-center gap-3">
									<div className="size-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
										<UsersIcon className="size-5 text-blue-500 dark:text-blue-400" />
									</div>
									<div>
										<div className="text-2xl font-bold text-foreground">
											{data?.stats?.total ?? 0}
										</div>
										<div className="text-sm text-foreground/60">
											Total referrals
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-6">
								<div className="flex items-center gap-3">
									<div className="size-10 rounded-xl bg-green-500/10 flex items-center justify-center">
										<TrendingUpIcon className="size-5 text-green-500 dark:text-green-400" />
									</div>
									<div>
										<div className="text-2xl font-bold text-foreground">
											{data?.stats?.completed ?? 0}
										</div>
										<div className="text-sm text-foreground/60">
											Converted
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-6">
								<div className="flex items-center gap-3">
									<div className="size-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
										<GiftIcon className="size-5 text-violet-500 dark:text-violet-400" />
									</div>
									<div>
										<div className="text-2xl font-bold text-foreground">
											{data?.stats?.rewarded ?? 0}
										</div>
										<div className="text-sm text-foreground/60">
											Rewards earned
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					</>
				)}
			</div>

			{/* Referral link */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">
						Your referral link
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{isLoading ? (
						<Skeleton className="h-10 w-full" />
					) : (
						<div className="flex items-center gap-2">
							<Input
								readOnly
								value={data?.referralLink ?? "Loading..."}
								className="font-mono text-sm"
							/>
							<Button
								variant="outline"
								size="icon"
								onClick={copyLink}
								aria-label="Copy to clipboard"
							>
								<CopyIcon className="size-4" />
							</Button>
						</div>
					)}
					{copied && (
						<p className="text-xs text-green-600 dark:text-green-400 font-medium">
							Copied to clipboard!
						</p>
					)}
					<p className="text-xs text-foreground/50">
						Share this link with friends. When they sign up and
						activate their account, you both earn rewards.
					</p>
					{/* Share buttons */}
					<div className="flex flex-wrap gap-2 pt-2">
						{data?.referralLink && (
							<>
								<Button variant="outline" size="sm" asChild>
									<a
										href={`https://twitter.com/intent/tweet?text=I%20use%20SmartBeak%20to%20manage%20my%20domain%20portfolio.%20Join%20me%3A%20${encodeURIComponent(data.referralLink)}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										Share on X
									</a>
								</Button>
								<Button variant="outline" size="sm" asChild>
									<a
										href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(data.referralLink)}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										Share on LinkedIn
									</a>
								</Button>
							</>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Referrals table */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">
						Referral history
					</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-3">
							{Array.from({ length: 3 }).map((_, i) => (
								<Skeleton key={i} className="h-10 w-full" />
							))}
						</div>
					) : !data?.referrals?.length ? (
						<div className="text-center py-10 text-foreground/40">
							<UsersIcon className="size-8 mx-auto mb-3 opacity-40" />
							<p className="text-sm">
								No referrals yet. Share your link to get
								started!
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Referred User</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Reward</TableHead>
									<TableHead>Date</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.referrals.map(
									(ref: {
										id: string;
										referredUserId: string | null;
										status: string;
										rewardGranted: boolean;
										rewardType: string | null;
										rewardValue: string | null;
										createdAt: string | Date;
									}) => (
										<TableRow key={ref.id}>
											<TableCell className="font-mono text-sm text-foreground/70">
												{ref.referredUserId
													? `${ref.referredUserId.slice(0, 8)}...`
													: "Pending signup"}
											</TableCell>
											<TableCell>
												<Badge
													status={
														ref.status ===
														"completed"
															? "success"
															: "info"
													}
													className="text-xs"
												>
													{ref.status}
												</Badge>
											</TableCell>
											<TableCell>
												{ref.rewardGranted ? (
													<span className="text-xs text-green-600 dark:text-green-400 font-medium">
														{ref.rewardType}:{" "}
														{ref.rewardValue}
													</span>
												) : (
													<span className="text-xs text-foreground/40">
														Pending
													</span>
												)}
											</TableCell>
											<TableCell className="text-sm text-foreground/60">
												{new Date(
													ref.createdAt,
												).toLocaleDateString()}
											</TableCell>
										</TableRow>
									),
								)}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
