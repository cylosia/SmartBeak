
import React, { useState } from 'react';
export type Target = 'vercel' | 'wordpress' | 'facebook';

export interface PublishIntent {
  target: Target;
  scheduledFor: null;
}

export interface PublishIntentModalProps {
  onSubmit: (intents: PublishIntent[]) => void;
}

export function PublishIntentModal({ onSubmit }: PublishIntentModalProps) {
  const [targets, setTargets] = useState<Target[]>([]);

  function toggleTarget(t: Target) {
  setTargets(prev =>
    prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
  );
  }

  function submit() {
  const intents: PublishIntent[] = targets.map(t => ({
    target: t,
    scheduledFor: null
  }));
  onSubmit(intents);
  }

  return (
  <div role="dialog" aria-modal="true" aria-labelledby="publish-intent-heading">
    <h2 id="publish-intent-heading">Create Publish Intents</h2>
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
    <fieldset>
      <legend>Select publish targets</legend>
      <label htmlFor='target-vercel'>
      <input
        id='target-vercel'
        type='checkbox'
        checked={targets.includes('vercel')}
        onChange={() => toggleTarget('vercel')}
      />
      Web (Vercel)
      </label>

      <label htmlFor='target-wordpress'>
      <input
        id='target-wordpress'
        type='checkbox'
        checked={targets.includes('wordpress')}
        onChange={() => toggleTarget('wordpress')}
      />
      WordPress
      </label>

      <label htmlFor='target-facebook'>
      <input
        id='target-facebook'
        type='checkbox'
        checked={targets.includes('facebook')}
        onChange={() => toggleTarget('facebook')}
      />
      Facebook
      </label>
    </fieldset>

    <button
      type='submit'
      disabled={targets.length === 0}
      aria-disabled={targets.length === 0}
    >
      Create {targets.length} Publish Intent(s)
    </button>
    </form>
  </div>
  );
}
