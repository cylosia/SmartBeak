
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';
export default function LlmAttribution({ rows }: any) {
  return (
  <main>
    <h1>LLM Model Attribution</h1>
    <pre>{JSON.stringify(rows, null, 2)}</pre>
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('attribution/llm'), { ctx });
  const rows = await res.json();
  return { props: { rows } };
};
