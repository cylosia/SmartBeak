interface SeoHeadProps {
  seo: { title?: string; description?: string; canonical?: string; ogImage?: string };
}

export default function SeoHead({ seo }: SeoHeadProps) {
  return (
  <>
    <title>{seo.title}</title>
    <meta name='description' content={seo.description} />
  </>
  );
}
