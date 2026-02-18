import type { GetServerSidePropsContext, GetServerSideProps } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { authFetch, apiUrl } from '../../lib/api-client';

// P0-5 FIX: getServerSideProps fetched API data without calling getAuth().
// Any unauthenticated request would trigger downstream API calls and render
// the page with whatever data the (unauthenticated) API returned.
export const getServerSideProps: GetServerSideProps = async (ctx: GetServerSidePropsContext) => {
  const { userId } = getAuth(ctx.req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  const [modelsRes, prefsRes] = await Promise.all([
    authFetch(apiUrl('llm/models'), { ctx }),
    authFetch(apiUrl('llm/preferences'), { ctx }),
  ]);

  const [models, prefs] = await Promise.all([
    modelsRes.json(),
    prefsRes.json(),
  ]);

  return { props: { models, prefs } };
};

export default function AiTools({ models, prefs }: Record<string, unknown>) {
  return (
    <main>
      <h1>AI Tools</h1>

      <section>
        <h2>Available Models</h2>
        <pre>{JSON.stringify(models, null, 2)}</pre>
      </section>

      <section>
        <h2>Task Preferences</h2>
        <pre>{JSON.stringify(prefs, null, 2)}</pre>
      </section>
    </main>
  );
}
