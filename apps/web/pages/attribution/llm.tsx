
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';

// P1-FIX: Replace `any` with proper type
interface LlmAttributionRow {
  model: string;
  provider: string;
  usageCount: number;
  totalTokens: number;
}

export default function LlmAttribution({ rows }: { rows: LlmAttributionRow[] }) {
  return (
  <main>
    <h1>LLM Model Attribution</h1>
    <pre>{JSON.stringify(rows, null, 2)}</pre>
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  try {
    const res = await authFetch(apiUrl('attribution/llm'), { ctx });
    if (!res.ok) {
      return { props: { rows: [] } };
    }
    const rows = (await res.json()) as LlmAttributionRow[];
    return { props: { rows } };
  } catch {
    return { props: { rows: [] } };
  }
};
