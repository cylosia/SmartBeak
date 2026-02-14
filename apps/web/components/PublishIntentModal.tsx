
import React, { useState, useRef } from 'react';
import { useTranslation } from '../lib/i18n';
import { useFocusTrap } from '../lib/use-focus-trap';

export type Target = 'vercel' | 'wordpress' | 'facebook';

export interface PublishIntent {
  target: Target;
  scheduledFor: null;
}

export interface PublishIntentModalProps {
  onSubmit: (intents: PublishIntent[]) => void;
  onClose?: () => void;
}

export function PublishIntentModal({ onSubmit, onClose }: PublishIntentModalProps) {
  const [targets, setTargets] = useState<Target[]>([]);
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, {
    ...(onClose ? { onEscape: onClose } : {}),
  });

  function toggleTarget(target: Target) {
  setTargets(prev =>
    prev.includes(target) ? prev.filter(x => x !== target) : [...prev, target]
  );
  }

  function submit() {
  const intents: PublishIntent[] = targets.map(target => ({
    target,
    scheduledFor: null
  }));
  onSubmit(intents);
  }

  return (
  <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="publish-intent-heading">
    <h2 id="publish-intent-heading">{t('publish.createIntents')}</h2>
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
    <fieldset>
      <legend>{t('publish.selectTargets')}</legend>
      <label htmlFor='target-vercel'>
      <input
        id='target-vercel'
        type='checkbox'
        checked={targets.includes('vercel')}
        onChange={() => toggleTarget('vercel')}
      />
      {t('publish.targetVercel')}
      </label>

      <label htmlFor='target-wordpress'>
      <input
        id='target-wordpress'
        type='checkbox'
        checked={targets.includes('wordpress')}
        onChange={() => toggleTarget('wordpress')}
      />
      {t('publish.targetWordpress')}
      </label>

      <label htmlFor='target-facebook'>
      <input
        id='target-facebook'
        type='checkbox'
        checked={targets.includes('facebook')}
        onChange={() => toggleTarget('facebook')}
      />
      {t('publish.targetFacebook')}
      </label>
    </fieldset>

    <button
      type='submit'
      disabled={targets.length === 0}
      aria-disabled={targets.length === 0}
    >
      {t('publish.createCount', { count: targets.length })}
    </button>
    </form>
  </div>
  );
}
