import type { NextPageContext } from 'next';

interface ErrorPageProps {
  statusCode: number | undefined;
}

function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <div style={{ padding: 48, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <h1>{statusCode ?? 'Error'}</h1>
      <p>
        {statusCode === 404
          ? 'This page could not be found.'
          : 'An unexpected error occurred.'}
      </p>
      <a href="/" style={{ color: '#0070f3' }}>
        Go home
      </a>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;
