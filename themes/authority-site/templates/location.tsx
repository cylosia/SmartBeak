import { sanitizeHtml } from '../../sanitize';

export default function LocationTemplate({ data }: { data?: { title?: string; body?: string } }) {
  return (
  <div>
    <h1>{data?.title}</h1>
    <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(data?.body) }} />
  </div>
  );
}