import {
  completeOnboardingStep,
  getOnboardingProgress,
} from "./procedures/onboarding";

export const onboardingRouter = {
  getProgress: getOnboardingProgress,
  completeStep: completeOnboardingStep,
};
