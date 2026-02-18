import type { GetServerSidePropsContext, GetServerSideProps } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { AppShell } from '../../components/AppShell';

// P0-5 FIX: Page was served without any authentication check.
// Account settings must be gated behind authentication.
export const getServerSideProps: GetServerSideProps = async (ctx: GetServerSidePropsContext) => {
  const { userId } = getAuth(ctx.req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: {} };
};

export default function AccountSettings() {
  return (
    <AppShell>
      <h1>Account Settings</h1>
      <form>
        <label>Organization Name<br /><input type='text' /></label><br /><br />
        <label>Primary Contact Email<br /><input type='email' /></label><br /><br />
        <label>Timezone<br /><input type='text' /></label><br /><br />
        <label>Reporting Currency<br /><input type='text' /></label><br /><br />
        <button type='submit'>Save</button>
      </form>
    </AppShell>
  );
}
