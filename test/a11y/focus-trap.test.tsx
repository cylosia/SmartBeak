import React, { useRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { useFocusTrap } from '../../apps/web/lib/use-focus-trap';

function TestDialog({ onEscape }: { onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { onEscape });
  return (
    <div ref={ref} role="dialog">
      <button>First</button>
      <button>Second</button>
      <button>Third</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('should focus first focusable element on mount', () => {
    const { getByText } = render(<TestDialog onEscape={() => {}} />);
    expect(document.activeElement).toBe(getByText('First'));
  });

  it('should call onEscape when Escape key is pressed', () => {
    const onEscape = jest.fn();
    render(<TestDialog onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('should wrap focus from last to first on Tab', () => {
    const { getByText } = render(<TestDialog onEscape={() => {}} />);
    getByText('Third').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByText('First'));
  });

  it('should wrap focus from first to last on Shift+Tab', () => {
    const { getByText } = render(<TestDialog onEscape={() => {}} />);
    getByText('First').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByText('Third'));
  });
});
