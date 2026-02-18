
import type { GetServerSideProps } from 'next';
import { AppShell } from '../../../components/AppShell';
import { requireServerAuth } from '../../../lib/server-auth';

interface LifecycleProps {
  domainId: string;
}

export default function DomainLifecycle({ domainId: _domainId }: LifecycleProps) {
  return (
  <AppShell>
    <h1>Domain Lifecycle</h1>
    <p>Archive or transfer this domain. These actions are irreversible.</p>
    <button disabled>Archive Domain</button>
    <button disabled>Transfer Domain</button>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const auth = await requireServerAuth(ctx);
  if (!auth) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  const domainId = ctx.params?.['id'];
  if (typeof domainId !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId } };
};
