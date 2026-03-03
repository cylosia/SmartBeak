import { getDomainDiligence, getPortfolioSummary } from "./procedures/get-portfolio";

export const portfolioRouter = {
  getSummary: getPortfolioSummary,
  getDiligence: getDomainDiligence,
};
