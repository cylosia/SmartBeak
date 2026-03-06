import {
	getOrgTierProcedure,
	getUsageWithLimitsProcedure,
	listBillingTiersProcedure,
	setOrgTierProcedure,
	updateSeatsProcedure,
} from "./procedures/manage-billing";

export const enterpriseBillingRouter = {
	tiers: listBillingTiersProcedure,
	orgTier: {
		get: getOrgTierProcedure,
		set: setOrgTierProcedure,
	},
	seats: updateSeatsProcedure,
	usage: getUsageWithLimitsProcedure,
};
