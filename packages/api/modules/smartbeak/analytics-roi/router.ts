import {
	getAnalyticsOverview,
	getMonetizationDecayView,
	getPortfolioTrendView,
} from "./procedures/analytics-views";
import {
	getBuyerAttributionDomain,
	getBuyerAttributionOrg,
	trackBuyerSession,
} from "./procedures/buyer-attribution";
import {
	getDiligenceReportProc,
	runDiligenceEngine,
	updateDiligenceCheck,
} from "./procedures/diligence-engine";
import {
	getPortfolioRoi,
	getPortfolioTrendData,
} from "./procedures/get-portfolio-roi";
import { getSellReadyScoreProc } from "./procedures/sell-ready-score";

export const analyticsRoiRouter = {
	// Portfolio ROI
	getPortfolioRoi,
	getPortfolioTrend: getPortfolioTrendData,

	// Diligence Engine
	getDiligenceReport: getDiligenceReportProc,
	runDiligence: runDiligenceEngine,
	updateDiligenceCheck,

	// Sell-Readiness Estimate
	getSellReadyScore: getSellReadyScoreProc,

	// Buyer Attribution
	getBuyerAttributionDomain,
	getBuyerAttributionOrg,
	trackBuyerSession,

	// Advanced Analytics Views
	getMonetizationDecay: getMonetizationDecayView,
	getPortfolioTrendView,
	getOverview: getAnalyticsOverview,
};
