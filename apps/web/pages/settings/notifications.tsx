
import { useState, useEffect, ChangeEvent } from 'react';

import { AppShell } from '../../components/AppShell';
import { apiUrl } from '../../lib/api-client';

interface Preference {
  channel: string;
  enabled: boolean;
  frequency?: string;
}

const CHANNELS = [
  { id: 'affiliate_terminated', label: 'Affiliate offer terminated' },
  { id: 'monetization_decay', label: 'Monetization decay' },
  { id: 'pending_intents', label: 'Pending intents' },
];

// H7-FIX: Connected notification preferences to GET/POST /notifications/preferences API
export default function NotificationSettings() {
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(apiUrl('notifications/preferences'), { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((prefs: Preference[]) => {
        const map: Record<string, boolean> = {};
        if (Array.isArray(prefs)) {
          prefs.forEach(p => { map[p.channel] = p.enabled; });
        }
        setPreferences(map);
      })
      .catch(() => {});
  }, []);

  const handleToggle = async (channel: string, e: ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setPreferences(prev => ({ ...prev, [channel]: enabled }));
    setSaving(true);

    try {
      await fetch(apiUrl('notifications/preferences'), {
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
