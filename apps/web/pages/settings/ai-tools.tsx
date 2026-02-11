
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';
export default function AiTools({ models, prefs }: any) {
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

export const getServerSideProps: GetServerSideProps = async (ctx) => {
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
