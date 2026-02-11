/**
* Usage forecast result
*/
export type UsageForecast = {
  /** Forecast period in days */
  period_days: number;
  /** Projected number of jobs */
  projected_jobs: number;
  /** Projected cost in USD */
  projected_cost_usd: number;
};

/**
* Type guard for UsageForecast
* MEDIUM FIX M15: Add runtime type validation
*/
export function isUsageForecast(obj: unknown): obj is UsageForecast {
  if (typeof obj !== 'object' || obj === null) return false;
  const forecast = obj as UsageForecast;
  return (
  typeof forecast.period_days === 'number' &&
  typeof forecast.projected_jobs === 'number' &&
  typeof forecast.projected_cost_usd === 'number'
  );
}

/**
* Input parameters for usage forecasting
*/
export interface UsageForecastInput {
  /** Average daily job count */
  avg_daily_jobs: number;
  /** Cost per job in USD */
  cost_per_job_usd: number;
  /** Forecast period in days */
  period_days: number;
}

/**
* Forecast usage based on historical averages
* @param input - Forecast input parameters
* @returns Usage forecast
* MEDIUM FIX M3: Added JSDoc documentation
*/
export function forecastUsage(input: UsageForecastInput): UsageForecast {
  if (typeof input.avg_daily_jobs !== 'number' || input.avg_daily_jobs < 0) {
  throw new Error('Invalid avg_daily_jobs: must be a non-negative number');
  }
  if (typeof input.cost_per_job_usd !== 'number' || input.cost_per_job_usd < 0) {
  throw new Error('Invalid cost_per_job_usd: must be a non-negative number');
  }
  if (typeof input.period_days !== 'number' || input.period_days < 1) {
  throw new Error('Invalid period_days: must be a positive number');
  }

  const projected_jobs = Math.round(input.avg_daily_jobs * input.period_days);
  const projected_cost_usd =
  Math.round(projected_jobs * input.cost_per_job_usd * 100) / 100;
  return {
  period_days: input.period_days,
  projected_jobs,
  projected_cost_usd
  };
}
