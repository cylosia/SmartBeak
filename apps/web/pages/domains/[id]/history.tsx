import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
import { authFetch, apiUrl } from '../../../lib/api-client';

interface ActivityEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  domainId: string;
  userId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface DomainHistoryProps {
  domainId: string;
  activityEvents: ActivityEvent[];
  error?: string;
}

// P1-AUDIT-FIX: Replaced hardcoded mock data with actual activity log fetching.
// Now displays real audit trail of domain changes with user who made them.
export default function DomainHistory({ domainId, activityEvents, error }: DomainHistoryProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      'created': 'Created',
      'updated': 'Updated',
      'deleted': 'Deleted',
      'archived': 'Archived',
      'published': 'Published',
    };
    return labels[action] || action;
  };

  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='history' />
      <h2>Domain History</h2>

      {error && (
        <p style={{ color: 'red' }}>
          Error loading history: {error}
        </p>
      )}

      {!error && activityEvents.length === 0 && (
        <p style={{ color: '#666', fontStyle: 'italic' }}>
          No activity history available for this domain.
        </p>
      )}

      {!error && activityEvents.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ccc' }}>
              <th style={{ textAlign: 'left', padding: '10px' }}>Action</th>
              <th style={{ textAlign: 'left', padding: '10px' }}>Entity</th>
              <th style={{ textAlign: 'left', padding: '10px' }}>User</th>
              <th style={{ textAlign: 'left', padding: '10px' }}>Date/Time</th>
              <th style={{ textAlign: 'left', padding: '10px' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {activityEvents.map((event) => (
              <tr key={event.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '10px' }}>
                  <strong>{getActionLabel(event.action)}</strong>
                </td>
                <td style={{ padding: '10px' }}>
                  {event.entityType} ({event.entityId.substring(0, 8)}...)
                </td>
                <td style={{ padding: '10px' }}>
                  {event.userId}
                </td>
                <td style={{ padding: '10px' }}>
                  {formatDate(event.createdAt)}
                </td>
                <td style={{ padding: '10px' }}>
                  {event.metadata && (
                    <details style={{ cursor: 'pointer' }}>
                      <summary>View</summary>
                      <pre style={{ fontSize: '12px', margin: '5px 0' }}>
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  // P2-AUDIT-FIX: Validate domainId format (UUID)
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { notFound: true };
  }

  try {
    // Fetch activity logs for this domain
    const response = await authFetch(
      apiUrl(`activity?domainId=${id}&limit=50&offset=0`),
      { ctx: { req } }
    );

    if (!response.ok) {
      return {
        props: {
          domainId: id,
          activityEvents: [],
          error: 'Failed to load activity logs',
        },
      };
    }

    const data = await response.json();
    return {
      props: {
        domainId: id,
        activityEvents: data.data || [],
      },
    };
  } catch (err) {
    return {
      props: {
        domainId: id,
        activityEvents: [],
        error: 'Unable to fetch activity logs',
      },
    };
  }
}
