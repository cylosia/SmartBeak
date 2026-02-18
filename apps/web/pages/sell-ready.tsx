import { getAuth } from '@clerk/nextjs/server';
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/sign-in', permanent: false } };
  }
  return { props: {} };
};

export default function SellReady() {
  const checklist = [
  'Revenue confidence documented',
  'Affiliate dependencies disclosed',
  'Replaceability assessed',
  'Historical decisions auditable',
  'No critical unresolved risks'
  ];

  return (
  <main>
    <h1>Ready to Sell?</h1>
    <ul>
    {checklist.map((c) => (
      <li key={c}>⬜ {c}</li>
    ))}
    </ul>
    <p>
    This checklist is advisory. It highlights readiness, not guarantees.
    </p>
  </main>
  );
}
