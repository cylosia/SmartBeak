export type ThemeConfig = {
  colorScheme: 'light' | 'dark';
  showNewsletterSignup?: boolean;
  enableComparisons?: boolean;
};

export const defaultConfig: ThemeConfig = {
  colorScheme: 'light',
  showNewsletterSignup: true,
  enableComparisons: false
};
