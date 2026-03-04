import { generateAiIdeas } from "./procedures/generate-ai-ideas";
import { getKeywordDashboard } from "./procedures/get-keyword-dashboard";
import { getSeoReport } from "./procedures/get-seo-report";
import { optimizeContent } from "./procedures/optimize-content";
import { runDecayJob } from "./procedures/run-decay-job";
import { syncAhrefs } from "./procedures/sync-ahrefs";
import { syncGsc } from "./procedures/sync-gsc";
import { updateKeyword } from "./procedures/update-keyword-metrics";

export const seoIntelligenceRouter = {
  // Keyword dashboard
  getKeywordDashboard,
  updateKeyword,
  // AI content generation
  generateAiIdeas,
  // Real-time content optimizer
  optimizeContent,
  // Integrations
  syncGsc,
  syncAhrefs,
  // Background jobs
  runDecayJob,
  // Reports
  getSeoReport,
};
