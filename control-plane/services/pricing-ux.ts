
import type { OrgId } from '@kernel/branded';
import { BillingService } from './billing';
import { UsageService } from './usage';

export class PricingUXService {
  constructor(
  private billing: BillingService,
  private usage: UsageService
  ) {}

  async getDomainAllowance(orgId: string) {
  const plan = await this.billing.getActivePlan(orgId as OrgId);
  const usage = await this.usage.getUsage(orgId) as Record<string, number>;

  if (!plan || plan.max_domains === null) {
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
