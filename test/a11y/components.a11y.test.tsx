import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// Mock next/navigation for AppShell
jest.mock('next/navigation', () => ({
  usePathname: () => '/portfolio',
}));

// Mock theme module for AppShell
jest.mock('../../apps/web/lib/theme', () => ({
  ThemeToggle: () => <button>Toggle theme</button>,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('Accessibility: AppShell', () => {
  it('should have no a11y violations', async () => {
    const { AppShell } = await import('../../apps/web/components/AppShell');
    const { container } = render(
      <AppShell><div>Content</div></AppShell>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: ContentFilters', () => {
  it('should have no a11y violations', async () => {
    const { ContentFilters } = await import('../../apps/web/components/ContentFilters');
    const { container } = render(
      <ContentFilters onFilter={() => {}} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: ErrorBoundary', () => {
  it('error state should have role="alert" and no a11y violations', async () => {
    const { ErrorBoundary } = await import('../../apps/web/components/ErrorBoundary');

    // Suppress console.error from the intentional throw
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    function ThrowError(): never {
      throw new Error('Test error');
    }

    const { container } = render(
      <ErrorBoundary><ThrowError /></ErrorBoundary>,
    );

    expect(container.querySelector('[role="alert"]')).toBeTruthy();

    const results = await axe(container);
    expect(results).toHaveNoViolations();

    spy.mockRestore();
  });
});

describe('Accessibility: PublishIntentModal', () => {
  it('should have no a11y violations', async () => {
    const { PublishIntentModal } = await import('../../apps/web/components/PublishIntentModal');
    const { container } = render(
      <PublishIntentModal onSubmit={() => {}} onClose={() => {}} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: ImageEditor', () => {
  it('should have no a11y violations', async () => {
    const { ImageEditor } = await import('../../apps/web/components/editors/ImageEditor');
    const { container } = render(<ImageEditor />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: ImageReviewPanel', () => {
  it('should have no a11y violations', async () => {
    const { ImageReviewPanel } = await import('../../apps/web/components/ImageReviewPanel');
    const { container } = render(
      <ImageReviewPanel
        image={{ url: 'https://example.com/img.jpg' }}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: Loading', () => {
  it('should have no a11y violations', async () => {
    const { Loading } = await import('../../apps/web/components/Loading');
    const { container } = render(<Loading />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: ContentBulkReviewBar', () => {
  it('should have persistent aria-live region when empty', async () => {
    const { ContentBulkReviewBar } = await import('../../apps/web/components/ContentBulkReviewBar');
    const { container } = render(
      <ContentBulkReviewBar selected={[]} />,
    );
    // The live region container should always be in the DOM
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('should announce selection count', async () => {
    const { ContentBulkReviewBar } = await import('../../apps/web/components/ContentBulkReviewBar');
    const { container } = render(
      <ContentBulkReviewBar selected={['1', '2']} />,
    );
    expect(container.textContent).toContain('2 selected');
  });
});
