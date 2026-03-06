import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DomainDetailPage from "@/pages/domain-detail";
import DomainsPage from "@/pages/domains";
import NotFound from "@/pages/not-found";
import { queryClient } from "./lib/queryClient";

function Router() {
	return (
		<Switch>
			<Route path="/" component={DomainsPage} />
			<Route path="/domains/:id" component={DomainDetailPage} />
			<Route component={NotFound} />
		</Switch>
	);
}

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<Toaster />
				<Router />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

export default App;
