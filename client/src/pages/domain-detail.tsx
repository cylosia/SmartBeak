import type { AuditLog, Domain, SiteShard } from "@shared/schema";
import { THEME_OPTIONS } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	CheckCircle2,
	Clock,
	ExternalLink,
	Eye,
	FileText,
	Globe,
	Layers,
	LayoutTemplate,
	Loader2,
	Rocket,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const THEME_LABELS: Record<string, string> = {
	"affiliate-comparison": "Affiliate Comparison",
	"authority-site": "Authority Site",
	"landing-leadgen": "Landing - Lead Gen",
	"local-business": "Local Business",
	"media-newsletter": "Media & Newsletter",
};

type DomainDetail = Domain & {
	shards: SiteShard[];
	latestShard: SiteShard | null;
};

function StatusBadge({ status }: { status: string }) {
	switch (status) {
		case "ready":
			return (
				<Badge
					variant="secondary"
					className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
				>
					<CheckCircle2 className="w-3 h-3 mr-1" />
					Live
				</Badge>
			);
		case "building":
		case "deploying":
		case "pending":
			return (
				<Badge
					variant="secondary"
					className="bg-amber-500/10 text-amber-700 dark:text-amber-400"
				>
					<Loader2 className="w-3 h-3 mr-1 animate-spin" />
					{status === "pending"
						? "Queued"
						: status === "building"
							? "Building"
							: "Deploying"}
				</Badge>
			);
		case "error":
			return (
				<Badge variant="destructive">
					<XCircle className="w-3 h-3 mr-1" />
					Error
				</Badge>
			);
		default:
			return <Badge variant="secondary">{status}</Badge>;
	}
}

export default function DomainDetailPage() {
	const { id } = useParams<{ id: string }>();
	const [, setLocation] = useLocation();
	const { toast } = useToast();
	const [deployOpen, setDeployOpen] = useState(false);
	const [deployTheme, setDeployTheme] = useState<string>("landing-leadgen");
	const [previewOpen, setPreviewOpen] = useState(false);
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const { data: domain, isLoading } = useQuery<DomainDetail>({
		queryKey: ["/api/domains", id],
	});

	const { data: auditLogs } = useQuery<AuditLog[]>({
		queryKey: ["/api/audit-logs"],
	});

	const isDeploying =
		domain?.latestShard &&
		["pending", "building", "deploying"].includes(
			domain.latestShard.status,
		);

	useEffect(() => {
		if (isDeploying) {
			pollingRef.current = setInterval(() => {
				queryClient.invalidateQueries({
					queryKey: ["/api/domains", id],
				});
			}, 2000);
		} else {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
				pollingRef.current = null;
			}
		}
		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
			}
		};
	}, [isDeploying, id]);

	const deployMutation = useMutation({
		mutationFn: async ({ theme }: { theme: string }) => {
			const res = await apiRequest("POST", `/api/domains/${id}/deploy`, {
				theme,
			});
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["/api/domains", id] });
			toast({
				title: "Deployment started",
				description: "Your site is being deployed to Vercel.",
			});
			setDeployOpen(false);
		},
		onError: (err: Error) => {
			toast({
				title: "Deploy failed",
				description: err.message,
				variant: "destructive",
			});
		},
	});

	if (isLoading) {
		return (
			<div className="max-w-6xl mx-auto px-6 py-8">
				<Skeleton className="h-8 w-48 mb-6" />
				<div className="grid gap-4 md:grid-cols-3">
					<Skeleton className="h-32" />
					<Skeleton className="h-32" />
					<Skeleton className="h-32" />
				</div>
			</div>
		);
	}

	if (!domain) {
		return (
			<div className="max-w-6xl mx-auto px-6 py-16 text-center">
				<h2 className="text-xl font-semibold mb-2">Domain not found</h2>
				<p className="text-muted-foreground mb-4">
					The domain you're looking for doesn't exist.
				</p>
				<Button onClick={() => setLocation("/")}>
					<ArrowLeft className="w-4 h-4 mr-2" />
					Back to Domains
				</Button>
			</div>
		);
	}

	const latestShard = domain.latestShard;
	const domainAuditLogs =
		auditLogs?.filter(
			(log) =>
				log.entityId === domain.id ||
				domain.shards.some((s) => s.id === log.entityId),
		) || [];

	return (
		<div className="min-h-screen bg-background">
			<div className="max-w-6xl mx-auto px-6 py-8">
				<div className="flex items-center gap-3 mb-6">
					<Button
						variant="ghost"
						size="icon"
						data-testid="button-back"
						onClick={() => setLocation("/")}
					>
						<ArrowLeft className="w-4 h-4" />
					</Button>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-3 flex-wrap">
							<h1
								className="text-2xl font-bold tracking-tight truncate"
								data-testid="text-domain-name"
							>
								{domain.name}
							</h1>
							{latestShard && (
								<StatusBadge status={latestShard.status} />
							)}
						</div>
						{domain.description && (
							<p className="text-sm text-muted-foreground mt-1">
								{domain.description}
							</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						{latestShard?.deployedUrl && (
							<Button
								variant="outline"
								data-testid="button-visit-site"
								onClick={() =>
									window.open(
										latestShard.deployedUrl ?? "",
										"_blank",
									)
								}
							>
								<ExternalLink className="w-4 h-4 mr-2" />
								Visit Site
							</Button>
						)}
						<Button
							data-testid="button-deploy-site"
							onClick={() => {
								setDeployTheme(domain.theme);
								setDeployOpen(true);
							}}
							disabled={!!isDeploying}
						>
							{isDeploying ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									Deploying...
								</>
							) : (
								<>
									<Rocket className="w-4 h-4 mr-2" />
									Deploy Site
								</>
							)}
						</Button>
					</div>
				</div>

				{isDeploying && latestShard && (
					<Card className="mb-6 border-amber-200 dark:border-amber-900/50">
						<CardContent className="p-6">
							<div className="flex items-center justify-between gap-4 mb-3">
								<div className="flex items-center gap-2">
									<Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
									<span className="font-semibold">
										Deployment in Progress
									</span>
								</div>
								<span
									className="text-sm text-muted-foreground"
									data-testid="text-deploy-progress"
								>
									{latestShard.progress}%
								</span>
							</div>
							<Progress
								value={latestShard.progress}
								className="h-2 mb-2"
								data-testid="progress-deploy"
							/>
							<p className="text-xs text-muted-foreground">
								{latestShard.status === "pending" &&
									"Preparing deployment..."}
								{latestShard.status === "building" &&
									"Generating static site from template..."}
								{latestShard.status === "deploying" &&
									"Deploying to Vercel edge network..."}
							</p>
						</CardContent>
					</Card>
				)}

				<div className="grid gap-4 md:grid-cols-3 mb-6">
					<Card>
						<CardContent className="p-5">
							<div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
								<LayoutTemplate className="w-4 h-4" />
								Theme
							</div>
							<p
								className="font-semibold"
								data-testid="text-domain-theme"
							>
								{THEME_LABELS[domain.theme] || domain.theme}
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-5">
							<div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
								<Layers className="w-4 h-4" />
								Deployments
							</div>
							<p
								className="font-semibold"
								data-testid="text-deployment-count"
							>
								{domain.shards.length} total
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-5">
							<div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
								<Clock className="w-4 h-4" />
								Latest Version
							</div>
							<p
								className="font-semibold"
								data-testid="text-latest-version"
							>
								{latestShard
									? `v${latestShard.version}`
									: "No deployments yet"}
							</p>
						</CardContent>
					</Card>
				</div>

				<Tabs defaultValue="preview" className="space-y-4">
					<TabsList>
						<TabsTrigger value="preview" data-testid="tab-preview">
							<Eye className="w-4 h-4 mr-2" />
							Preview
						</TabsTrigger>
						<TabsTrigger value="history" data-testid="tab-history">
							<Layers className="w-4 h-4 mr-2" />
							History
						</TabsTrigger>
						<TabsTrigger value="logs" data-testid="tab-logs">
							<FileText className="w-4 h-4 mr-2" />
							Audit Log
						</TabsTrigger>
					</TabsList>

					<TabsContent value="preview">
						{latestShard?.deployedUrl &&
						latestShard.status === "ready" ? (
							<Card>
								<CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
									<CardTitle className="text-base">
										Live Preview
									</CardTitle>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											data-testid="button-fullscreen-preview"
											onClick={() => setPreviewOpen(true)}
										>
											<Eye className="w-3 h-3 mr-1" />
											Fullscreen
										</Button>
										<Button
											variant="outline"
											size="sm"
											data-testid="button-open-external"
											onClick={() =>
												window.open(
													latestShard.deployedUrl ??
														"",
													"_blank",
												)
											}
										>
											<ExternalLink className="w-3 h-3 mr-1" />
											Open
										</Button>
									</div>
								</CardHeader>
								<CardContent className="p-0">
									<div
										className="relative rounded-b-md border-t"
										style={{ height: "500px" }}
									>
										<iframe
											src={latestShard.deployedUrl}
											className="w-full h-full rounded-b-md"
											title="Site Preview"
											data-testid="iframe-preview"
											sandbox="allow-scripts allow-same-origin"
										/>
									</div>
								</CardContent>
							</Card>
						) : (
							<Card>
								<CardContent className="flex flex-col items-center justify-center py-16 text-center">
									<div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
										<Eye className="w-7 h-7 text-muted-foreground" />
									</div>
									<h3
										className="text-lg font-semibold mb-2"
										data-testid="text-no-preview"
									>
										No preview available
									</h3>
									<p className="text-muted-foreground mb-6 max-w-sm">
										{isDeploying
											? "Your site is currently being deployed. The preview will appear once it's live."
											: "Deploy your site to see a live preview here."}
									</p>
									{!isDeploying && (
										<Button
											data-testid="button-deploy-for-preview"
											onClick={() => {
												setDeployTheme(domain.theme);
												setDeployOpen(true);
											}}
										>
											<Rocket className="w-4 h-4 mr-2" />
											Deploy Now
										</Button>
									)}
								</CardContent>
							</Card>
						)}

						<Card className="mt-4">
							<CardHeader className="pb-3">
								<CardTitle className="text-base">
									Theme Preview
								</CardTitle>
							</CardHeader>
							<CardContent className="p-0">
								<div
									className="relative rounded-b-md border-t"
									style={{ height: "400px" }}
								>
									<iframe
										src={`/api/themes/${domain.theme}/preview?domain=${encodeURIComponent(domain.name)}`}
										className="w-full h-full rounded-b-md"
										title="Theme Preview"
										data-testid="iframe-theme-preview"
									/>
								</div>
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="history">
						{domain.shards.length === 0 ? (
							<Card>
								<CardContent className="flex flex-col items-center justify-center py-12 text-center">
									<Layers className="w-10 h-10 text-muted-foreground mb-3" />
									<p className="text-muted-foreground">
										No deployment history yet.
									</p>
								</CardContent>
							</Card>
						) : (
							<div className="space-y-3">
								{domain.shards.map((shard) => (
									<Card
										key={shard.id}
										data-testid={`card-shard-${shard.id}`}
									>
										<CardContent className="p-4">
											<div className="flex items-center justify-between gap-4">
												<div className="flex items-center gap-3 min-w-0">
													<div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
														<span className="text-xs font-bold">
															v{shard.version}
														</span>
													</div>
													<div className="min-w-0">
														<div className="flex items-center gap-2 flex-wrap">
															<span className="font-medium text-sm">
																{THEME_LABELS[
																	shard.theme
																] ||
																	shard.theme}
															</span>
															<StatusBadge
																status={
																	shard.status
																}
															/>
														</div>
														<div className="text-xs text-muted-foreground mt-0.5">
															{new Date(
																shard.createdAt,
															).toLocaleString()}
															{shard.deployedUrl && (
																<span>
																	{" "}
																	·{" "}
																	<a
																		href={
																			shard.deployedUrl
																		}
																		target="_blank"
																		rel="noopener noreferrer"
																		className="text-primary underline"
																		data-testid={`link-deployed-url-${shard.id}`}
																	>
																		{
																			shard.deployedUrl
																		}
																	</a>
																</span>
															)}
														</div>
														{shard.errorMessage && (
															<p className="text-xs text-destructive mt-1">
																{
																	shard.errorMessage
																}
															</p>
														)}
													</div>
												</div>
												{shard.deployedUrl &&
													shard.status ===
														"ready" && (
														<Button
															variant="outline"
															size="sm"
															data-testid={`button-open-shard-${shard.id}`}
															onClick={() =>
																window.open(
																	shard.deployedUrl ??
																		"",
																	"_blank",
																)
															}
														>
															<ExternalLink className="w-3 h-3 mr-1" />
															Visit
														</Button>
													)}
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</TabsContent>

					<TabsContent value="logs">
						<Card>
							<CardHeader className="pb-3">
								<CardTitle className="text-base">
									Activity Log
								</CardTitle>
							</CardHeader>
							<CardContent>
								{domainAuditLogs.length === 0 ? (
									<p className="text-sm text-muted-foreground text-center py-8">
										No activity recorded yet.
									</p>
								) : (
									<ScrollArea className="h-80">
										<div className="space-y-3">
											{domainAuditLogs.map((log) => (
												<div
													key={log.id}
													className="flex items-start gap-3"
													data-testid={`audit-log-${log.id}`}
												>
													<div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
													<div className="min-w-0">
														<p className="text-sm font-medium">
															{log.action
																.replace(
																	/_/g,
																	" ",
																)
																.replace(
																	/\b\w/g,
																	(c) =>
																		c.toUpperCase(),
																)}
														</p>
														<p className="text-xs text-muted-foreground">
															{new Date(
																log.createdAt,
															).toLocaleString()}
														</p>
													</div>
												</div>
											))}
										</div>
									</ScrollArea>
								)}
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			</div>

			<Dialog open={deployOpen} onOpenChange={setDeployOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Deploy {domain.name}</DialogTitle>
						<DialogDescription>
							Choose a theme and deploy a production-ready static
							site to Vercel.
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<div className="space-y-2">
							<Label>Theme Template</Label>
							<Select
								value={deployTheme}
								onValueChange={setDeployTheme}
							>
								<SelectTrigger data-testid="select-deploy-theme-detail">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{THEME_OPTIONS.map((t) => (
										<SelectItem key={t} value={t}>
											{THEME_LABELS[t]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="rounded-md border bg-muted/30 p-3">
							<div className="flex items-center gap-2 text-sm font-medium mb-1">
								<Globe className="w-4 h-4" />
								Deployment Details
							</div>
							<div className="text-xs text-muted-foreground space-y-1">
								<p>Domain: {domain.name}</p>
								<p>Template: {THEME_LABELS[deployTheme]}</p>
								<p>Target: Vercel Edge Network</p>
								{latestShard && (
									<p>
										Next version: v{latestShard.version + 1}
									</p>
								)}
							</div>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDeployOpen(false)}
						>
							Cancel
						</Button>
						<Button
							data-testid="button-confirm-deploy-detail"
							onClick={() =>
								deployMutation.mutate({ theme: deployTheme })
							}
							disabled={deployMutation.isPending}
						>
							<Rocket className="w-4 h-4 mr-2" />
							{deployMutation.isPending
								? "Starting..."
								: "Deploy to Vercel"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
				<DialogContent className="max-w-5xl h-[85vh]">
					<DialogHeader>
						<DialogTitle>{domain.name} - Live Preview</DialogTitle>
						<DialogDescription>
							Full preview of your deployed site
						</DialogDescription>
					</DialogHeader>
					{latestShard?.deployedUrl && (
						<iframe
							src={latestShard.deployedUrl}
							className="w-full flex-1 rounded-md border"
							title="Fullscreen Preview"
							data-testid="iframe-fullscreen-preview"
							sandbox="allow-scripts allow-same-origin"
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
