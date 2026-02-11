export type ImageVariant = {
  image_asset_id: string;
  variant_id: string;
};

export type ImageExperiment = {
  id: string;
  target: 'youtube_thumbnail' | 'pinterest_pin';
  variants: ImageVariant[];
  status: 'draft' | 'running' | 'completed';
};

export function startImageExperiment(exp: ImageExperiment) {
  if (exp.variants.length < 2) {
  throw new Error('At least two image variants required');
  }
  return { ...exp, status: 'running' };
}
