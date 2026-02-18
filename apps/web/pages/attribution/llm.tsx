
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';

interface LlmAttributionRow {
  model: string;
  provider: string;
  usageCount: number;
  totalTokens: number;
}

interface LlmAttributionProps {
  rows: LlmAttributionRow[];
  error?: string | undefined;
}

export default function LlmAttribution({ rows, error }: LlmAttributionProps) {
  return (
  <main>
    <h1>LLM Model Attribution</h1>
    {error ? (
    <p>Failed to load attribution data.</p>
    ) : (
    <pre>{JSON.stringify(rows, null, 2)}</pre>
    )}
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  try {
    const res = await authFetch(apiUrl('attribution/llm'), { ctx });
    if (!res.ok) {
      return { props: { rows: [], error: `API returned ${res.status}` } };
    }
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) {
      return { props: { rows: [], error: 'Invalid response format' } };
    }
    return { props: { rows: rows as LlmAttributionRow[] } };
  } catch {
    return { props: { rows: [], error: 'Failed to load' } };
  }
};
