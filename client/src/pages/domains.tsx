import type { Domain, SiteShard } from "@shared/schema";
import { THEME_OPTIONS } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Clock,
	ExternalLink,
	Globe,
	Layers,
	LayoutTemplate,
	Plus,
	Rocket,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const THEME_LABELS: Record<string, string> = {
	"affiliate-comparison": "Affiliate Comparison",
	"authority-site": "Authority Site",
	"landing-leadgen": "Landing - Lead Gen",
	"local-business": "Local Business",
	"media-newsletter": "Media & Newsletter",
};

const THEME_COLORS: Record<string, string> = {
	"affiliate-comparison":
		"bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
	"authority-site": "bg-blue-500/10 text-blue-700 dark:text-blue-400",
	"landing-leadgen":
		"bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
	"local-business": "bg-red-500/10 text-red-700 dark:text-red-400",
	"media-newsletter": "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

type DomainWithShard = Domain & { latestShard?: SiteShard | null };

export default function DomainsPage() {
	const [, setLocation] = useLocation();
	const { toast } = useToast();
	const [addOpen, setAddOpen] = useState(false);
	const [deployOpen, setDeployOpen] = useState(false);
	const [selectedDomain, setSelectedDomain] =
		useState<DomainWithShard | null>(null);
	const [newName, setNewName] = useState("");
	const [newTheme, setNewTheme] = useState<string>("landing-leadgen");
	const [newDesc, setNewDesc] = useState("");
	const [deployTheme, setDeployTheme] = useState<string>("landing-leadgen");

	const { data: domainList, isLoading } = useQuery<DomainWithShard[]>({
		queryKey: ["/api/domains"],
	});

	const createMutation = useMutation({
		mutationFn: async () => {
			const res = await apiRequest("POST", "/api/domains", {
				name: newName,
				theme: newTheme,
				description: newDesc || null,
				status: "active",
			});
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["/api/domains"] });
			toast({
				title: "Domain created",
				description: `${newName} has been added.`,
			});
			setAddOpen(false);
			setNewName("");
			setNewDesc("");
		},
		onError: (err: Error) => {
			toast({
				title: "Error",
				description: err.message,
				variant: "destructive",
			});
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await apiRequest("DELETE", `/api/domains/${id}`);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["/api/domains"] });
			toast({ title: "Domain deleted" });
		},
	});

	const deployMutation = useMutation({
		mutationFn: async ({
			domainId,
			theme,
		}: {
			domainId: string;
			theme: string;
		}) => {
			const res = await apiRequest(
				"POST",
				`/api/domains/${domainId}/deploy`,
				{ theme },
			);
			return res.json();
		},
		onSuccess: (shard: SiteShard) => {
			queryClient.invalidateQueries({ queryKey: ["/api/domains"] });
			toast({
				title: "Deployment started",
				description: "Your site is being deployed to Vercel.",
			});
			setDeployOpen(false);
			setLocation(`/domains/${shard.domainId}`);
		},
		onError: (err: Error) => {
			toast({
				title: "Deploy failed",
				description: err.message,
				variant: "destructive",
			});
		},
	});

	const openDeployDialog = (domain: DomainWithShard) => {
		setSelectedDomain(domain);
		setDeployTheme(domain.theme);
		setDeployOpen(true);
	};

	return (
		<div className="min-h-screen bg-background">
			<div className="max-w-6xl mx-auto px-6 py-8">
				<div className="flex items-center justify-between gap-4 mb-8">
					<div>
						<h1
							className="text-2xl font-bold tracking-tight"
							data-testid="text-page-title"
						>
							SmartDeploy
						</h1>
						<p className="text-muted-foreground mt-1">
							Manage domains and deploy themed sites to Vercel
						</p>
					</div>
					<Dialog open={addOpen} onOpenChange={setAddOpen}>
						<DialogTrigger asChild>
							<Button data-testid="button-add-domain">
								<Plus className="w-4 h-4 mr-2" />
								Add Domain
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add New Domain</DialogTitle>
								<DialogDescription>
									Register a domain to deploy themed sites.
								</DialogDescription>
							</DialogHeader>
							<div className="flex flex-col gap-4 py-4">
								<div className="space-y-2">
									<Label htmlFor="domain-name">
										Domain Name
									</Label>
									<Input
										id="domain-name"
										data-testid="input-domain-name"
										placeholder="example.com"
										value={newName}
										onChange={(e) =>
											setNewName(e.target.value)
										}
									/>
								</div>
								<div className="space-y-2">
									<Label>Theme</Label>
									<Select
										value={newTheme}
										onValueChange={setNewTheme}
									>
										<SelectTrigger data-testid="select-theme">
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
								<div className="space-y-2">
									<Label htmlFor="domain-desc">
										Description (optional)
									</Label>
									<Input
										id="domain-desc"
										data-testid="input-domain-description"
										placeholder="My awesome website"
										value={newDesc}
										onChange={(e) =>
											setNewDesc(e.target.value)
										}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button
									data-testid="button-create-domain"
									onClick={() => createMutation.mutate()}
									disabled={
										!newName.trim() ||
										createMutation.isPending
									}
								>
									{createMutation.isPending
										? "Creating..."
										: "Create Domain"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>

				{isLoading ? (
					<div
						className="grid gap-4 md:grid-template-columns-2 lg:grid-cols-3"
						style={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fill, minmax(340px, 1fr))",
							gap: "16px",
						}}
					>
						{[1, 2, 3].map((i) => (
							<Card key={i}>
								<CardContent className="p-6">
									<Skeleton className="h-5 w-40 mb-3" />
									<Skeleton className="h-4 w-24 mb-4" />
									<Skeleton className="h-8 w-full" />
								</CardContent>
							</Card>
						))}
					</div>
				) : !domainList?.length ? (
					<Card>
						<CardContent className="flex flex-col items-center justify-center py-16 text-center">
							<div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
								<Globe className="w-8 h-8 text-muted-foreground" />
							</div>
							<h3
								className="text-lg font-semibold mb-2"
								data-testid="text-empty-state"
							>
								No domains yet
							</h3>
							<p className="text-muted-foreground mb-6 max-w-sm">
								Add your first domain to start deploying
								beautiful themed websites to Vercel.
							</p>
							<Button
								data-testid="button-add-domain-empty"
								onClick={() => setAddOpen(true)}
							>
								<Plus className="w-4 h-4 mr-2" />
								Add Your First Domain
							</Button>
						</CardContent>
					</Card>
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fill, minmax(340px, 1fr))",
							gap: "16px",
						}}
					>
						{domainList.map((domain) => (
							<Card
								key={domain.id}
								className="group cursor-pointer hover-elevate"
								data-testid={`card-domain-${domain.id}`}
							>
								<CardContent className="p-6">
									<div className="flex items-start justify-between gap-2 mb-3">
										<div className="flex items-center gap-2 min-w-0">
											<Globe className="w-4 h-4 text-muted-foreground shrink-0" />
											<span
												role="button"
												tabIndex={0}
												className="font-semibold truncate cursor-pointer"
												data-testid={`link-domain-${domain.id}`}
												onClick={() =>
													setLocation(
														`/domains/${domain.id}`,
													)
												}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														setLocation(`/domains/${domain.id}`);
													}
												}}
											>
												{domain.name}
											</span>
										</div>
										<Button
											size="icon"
											variant="ghost"
											data-testid={`button-delete-domain-${domain.id}`}
											onClick={(e) => {
												e.stopPropagation();
												deleteMutation.mutate(
													domain.id,
												);
											}}
										>
											<Trash2 className="w-4 h-4" />
										</Button>
									</div>

									<div className="flex flex-wrap items-center gap-2 mb-4">
										<Badge
											variant="secondary"
											className={
												THEME_COLORS[domain.theme] || ""
											}
										>
											<LayoutTemplate className="w-3 h-3 mr-1" />
											{THEME_LABELS[domain.theme] ||
												domain.theme}
										</Badge>
										{domain.latestShard?.status ===
											"ready" && (
											<Badge
												variant="secondary"
												className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
											>
												Live
											</Badge>
										)}
										{domain.latestShard?.status ===
											"deploying" ||
										domain.latestShard?.status ===
											"building" ? (
											<Badge
												variant="secondary"
												className="bg-amber-500/10 text-amber-700 dark:text-amber-400"
											>
												Deploying...
											</Badge>
										) : null}
										{domain.latestShard?.status ===
											"error" && (
											<Badge variant="destructive">
												Error
											</Badge>
										)}
									</div>

									{domain.description && (
										<p className="text-sm text-muted-foreground mb-4 line-clamp-2">
											{domain.description}
										</p>
									)}

									<div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
										<Clock className="w-3 h-3" />
										<span>
											Created{" "}
											{new Date(
												domain.createdAt,
											).toLocaleDateString()}
										</span>
										{domain.latestShard && (
											<>
												<span className="mx-1">·</span>
												<Layers className="w-3 h-3" />
												<span>
													v
													{domain.latestShard.version}
												</span>
											</>
										)}
									</div>

									<div className="flex items-center gap-2">
										<Button
											className="flex-1"
											data-testid={`button-deploy-${domain.id}`}
											onClick={(e) => {
												e.stopPropagation();
												openDeployDialog(domain);
											}}
										>
											<Rocket className="w-4 h-4 mr-2" />
											Deploy Site
										</Button>
										{domain.latestShard?.deployedUrl && (
											<Button
												variant="outline"
												size="icon"
												data-testid={`button-visit-${domain.id}`}
												onClick={(e) => {
													e.stopPropagation();
												window.open(
													domain.latestShard
														?.deployedUrl ?? "",
													"_blank",
												);
												}}
											>
												<ExternalLink className="w-4 h-4" />
											</Button>
										)}
										<Button
											variant="outline"
											data-testid={`button-details-${domain.id}`}
											onClick={(e) => {
												e.stopPropagation();
												setLocation(
													`/domains/${domain.id}`,
												);
											}}
										>
											Details
										</Button>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>

			<Dialog open={deployOpen} onOpenChange={setDeployOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Deploy {selectedDomain?.name}</DialogTitle>
						<DialogDescription>
							Select a theme and deploy to Vercel. This generates
							a production-ready static site.
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<div className="space-y-2">
							<Label>Theme Template</Label>
							<Select
								value={deployTheme}
								onValueChange={setDeployTheme}
							>
								<SelectTrigger data-testid="select-deploy-theme">
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
								<LayoutTemplate className="w-4 h-4" />
								Theme Preview
							</div>
							<p className="text-xs text-muted-foreground">
								{THEME_LABELS[deployTheme]} template will be
								generated with domain-specific branding.
							</p>
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
							data-testid="button-confirm-deploy"
							onClick={() => {
								if (selectedDomain) {
									deployMutation.mutate({
										domainId: selectedDomain.id,
										theme: deployTheme,
									});
								}
							}}
							disabled={deployMutation.isPending}
						>
							<Rocket className="w-4 h-4 mr-2" />
							{deployMutation.isPending
								? "Deploying..."
								: "Deploy to Vercel"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
