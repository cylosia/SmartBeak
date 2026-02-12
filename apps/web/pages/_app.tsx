import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { AppProps } from 'next/app';
import Head from 'next/head';

import { ErrorBoundary } from '../components/ErrorBoundary';
import { getQueryClient } from '../lib/query-client';
import { ThemeProvider } from '../lib/theme';
import '../styles/tokens.css';

/**
 * Next.js App Component
 * Provides app-wide configuration and providers
 */

export default function App({ Component, pageProps }: AppProps) {
  // Create QueryClient once per request on server, persist on client
  const queryClient = getQueryClient();

  return (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <Head>
      <title>ACP - Audience & Content Platform</title>
      <meta name='viewport' content='width=device-width, initial-scale=1' />
      <meta name='description' content='Business control plane for digital assets' />
    </Head>
    <ErrorBoundary>
    <Component {...pageProps} />
    </ErrorBoundary>
    <ReactQueryDevtools initialIsOpen={false} />
    </ThemeProvider>
  </QueryClientProvider>
  );
}
