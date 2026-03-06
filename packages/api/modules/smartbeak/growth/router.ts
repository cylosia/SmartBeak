import {
	sendOnboardingStepProcedure,
	triggerOnboardingSequenceProcedure,
} from "./procedures/onboarding-emails";
import {
	completeReferralProcedure,
	getMyReferralsProcedure,
	getReferralStatsByCodeProcedure,
	grantRewardProcedure,
} from "./procedures/referrals";
import {
	getWaitlistStatsProcedure,
	getWaitlistStatusProcedure,
	joinWaitlistProcedure,
	listWaitlistProcedure,
	updateWaitlistStatusProcedure,
} from "./procedures/waitlist";

export const growthRouter = {
	// Waitlist
	joinWaitlist: joinWaitlistProcedure,
	getWaitlistStatus: getWaitlistStatusProcedure,
	listWaitlist: listWaitlistProcedure,
	updateWaitlistStatus: updateWaitlistStatusProcedure,
	getWaitlistStats: getWaitlistStatsProcedure,
	// Referrals
	getMyReferrals: getMyReferralsProcedure,
	completeReferral: completeReferralProcedure,
	grantReward: grantRewardProcedure,
	getReferralStatsByCode: getReferralStatsByCodeProcedure,
	// Onboarding emails
	triggerOnboardingSequence: triggerOnboardingSequenceProcedure,
	sendOnboardingStep: sendOnboardingStepProcedure,
};
