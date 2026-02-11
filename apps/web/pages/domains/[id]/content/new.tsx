import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';

interface NewContentProps {
  domainId: string;
}

export default function NewContent({ domainId }: NewContentProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='content' />

      <h2>Create Content</h2>
      <p>Content is created as a draft and requires human approval to publish.</p>

      <form>
        <label>
          Title<br />
          <input type='text' />
        </label><br /><br />

        <label>
          Content Type<br />
          <select>
            <option>Web Page</option>
            <option>Blog Post</option>
            <option>Image</option>
            <option>Video</option>
            <option>Audio</option>
            <option>Social Post</option>
          </select>
        </label><br /><br />

        <button type='submit'>Create Draft</button>
      </form>
    </AppShell>
  );
}

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
