
import { useState, useEffect, ChangeEvent } from 'react';

import { AppShell } from '../../components/AppShell';
import { apiUrl } from '../../lib/api-client';
import { fetchWithCsrf } from '../../lib/csrf';

interface Preference {
  channel: string;
  enabled: boolean;
  frequency?: string;
}

// P1-FIX: Channel IDs must match backend ALLOWED_CHANNELS in NotificationPreferenceService
// Previous values (affiliate_terminated, monetization_decay, pending_intents) were notification
// event types, not delivery channels, causing every POST to fail server-side validation silently.
const CHANNELS = [
  { id: 'email', label: 'Email notifications' },
  { id: 'sms', label: 'SMS notifications' },
  { id: 'push', label: 'Push notifications' },
  { id: 'webhook', label: 'Webhook notifications' },
];

// H7-FIX: Connected notification preferences to GET/POST /notifications/preferences API
export default function NotificationSettings() {
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    // P2-FIX: No longer silently swallowing fetch errors — surface them to the user
    fetch(apiUrl('notifications/preferences'), { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Failed to load preferences');
        return res.json();
      })
      .then((prefs: Preference[]) => {
        const map: Record<string, boolean> = {};
        if (Array.isArray(prefs)) {
          prefs.forEach(p => { map[p.channel] = p.enabled; });
        }
        setPreferences(map);
      })
      .catch(() => { setLoadError('Unable to load notification preferences. Please try again later.'); });
  }, []);

  const handleToggle = async (channel: string, e: ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setPreferences(prev => ({ ...prev, [channel]: enabled }));
    setSaving(true);

    try {
      // P1-FIX: Use fetchWithCsrf to include X-CSRF-Token header
      await fetchWithCsrf(apiUrl('notifications/preferences'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel, enabled }),
      });
    } catch {
      setPreferences(prev => ({ ...prev, [channel]: !enabled }));
    } finally {
      setSaving(false);
    }
  };

  return (
  <AppShell>
    <h1>Notification Preferences</h1>
    {loadError && <p style={{ color: 'red' }}>{loadError}</p>}
    {CHANNELS.map(ch => (
      <label key={ch.id} style={{ display: 'block', marginBottom: 8 }}>
        <input
          type='checkbox'
          checked={preferences[ch.id] ?? false}
          onChange={e => handleToggle(ch.id, e)}
          disabled={saving}
        />
        {' '}{ch.label}
      </label>
    ))}
  </AppShell>
  );
}
