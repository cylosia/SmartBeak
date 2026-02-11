
import React from 'react';
export interface PublishTargetScheduleProps {
  target: string;
  value?: string | null;
  onChange: (value: string) => void;
}

export function PublishTargetSchedule({ target, value, onChange }: PublishTargetScheduleProps) {
  return (
  <div>
    <label htmlFor={`schedule-${target}`}>{target} schedule</label>
    <input
    id={`schedule-${target}`}
    type='datetime-local'
    value={value || ''}
    onChange={(e) => onChange((e.target as HTMLInputElement).value)}
    aria-label={`${target} schedule`}
    />
  </div>
  );
}
