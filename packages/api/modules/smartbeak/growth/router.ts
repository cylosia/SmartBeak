import {
  getWaitlistStatsProcedure,
  joinWaitlistProcedure,
  getWaitlistStatusProcedure,
  listWaitlistProcedure,
  updateWaitlistStatusProcedure,
} from "./procedures/waitlist";
import {
  completeReferralProcedure,
  getMyReferralsProcedure,
  getReferralStatsByCodeProcedure,
  grantRewardProcedure,
} from "./procedures/referrals";
import {
  sendOnboardingStepProcedure,
  triggerOnboardingSequenceProcedure,
} from "./procedures/onboarding-emails";

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
