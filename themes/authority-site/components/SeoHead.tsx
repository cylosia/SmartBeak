export default function SeoHead({ seo }: any) {
  return (
  <>
    <title>{seo.title}</title>
    <meta name='description' content={seo.description} />
  </>
  );
}
