export type SeoExperiment = {
  page_id: string;
  variant_a: { title: string; meta: string };
  variant_b: { title: string; meta: string };
  status: 'draft' | 'running' | 'completed';
};

export function createSeoExperiment(exp: SeoExperiment) {
  return { ...exp, status: 'running' };
}
