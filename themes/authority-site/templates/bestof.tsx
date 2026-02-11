import { sanitizeHtml } from '../../sanitize';

export default function BestofTemplate({ data }: { data?: { title?: string; body?: string } }) {
  return (
  <article>
    <h1>{data?.title}</h1>
    <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(data?.body) }} />
  </article>
  );
}