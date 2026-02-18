
import { GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { AppShell } from '../../components/AppShell';

// FIXED (IT-1): Page was unprotected — any unauthenticated visitor could view it.
// getServerSideProps redirects to /login if the Clerk session is absent.
export async function getServerSideProps({ req }: GetServerSidePropsContext) {
  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: {} };
}

export default function IntentTypes() {
  return (
  <AppShell>
    <h2>Intent Types</h2>
    <ul>
    <li>publish_content</li>
    <li>archive_content</li>
    <li>replace_affiliate_offer</li>
    <li>archive_domain</li>
    <li>transfer_domain</li>
    </ul>
  </AppShell>
  );
}
