import type { GetServerSidePropsContext, GetServerSideProps } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { AppShell } from '../components/AppShell';

// P0-5 FIX: Page was served without any authentication check, exposing the
// audit log page to unauthenticated users. Added server-side auth guard.
export const getServerSideProps: GetServerSideProps = async (ctx: GetServerSidePropsContext) => {
  const { userId } = getAuth(ctx.req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: {} };
};

export default function Activity() {
  return (
    <AppShell>
      <h1>Activity Log</h1>
      <p>Read-only log of significant actions.</p>
      <ul>
        <li>Domain created: example.com</li>
        <li>Intent approved: Replace Affiliate Offer</li>
        <li>Domain transferred</li>
      </ul>
    </AppShell>
  );
}
