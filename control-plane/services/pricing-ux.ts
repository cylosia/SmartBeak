
import { BillingService } from './billing';
import { UsageService } from './usage';

export class PricingUXService {
  constructor(
  private billing: BillingService,
  private usage: UsageService
  ) {}

  async getDomainAllowance(orgId: string) {
  // P2-FIX: getActivePlan and getUsage are independent; run in parallel to
  // take max(latencies) instead of accumulating both sequentially.
  const [plan, usageRaw] = await Promise.all([
    this.billing.getActivePlan(orgId),
    this.usage.getUsage(orgId),
  ]);
  const usage = usageRaw as Record<string, number>;

  // P1-FIX: Split no-plan from unlimited-plan case.
  // Previously !plan fell through to 'Unlimited domains', so users with
  // cancelled/expired/absent subscriptions got unlimited access.
  if (!plan) {
    return {
    allowed: false,
    upgradeRequired: true,
    message: 'No active subscription'
    };
  }

  if (plan.max_domains === null) {
    return {
    allowed: true,
    message: 'Unlimited domains'
    };
  }

  const domainCount = usage["domain_count"] ?? 0;
  const maxDomains = plan.max_domains ?? 0;
  if (domainCount < maxDomains) {
    return {
    allowed: true,
    remaining: maxDomains - domainCount
    };
  }

  return {
    allowed: false,
    upgradeRequired: true,
    message: 'Upgrade to add more domains'
  };
  }
}
