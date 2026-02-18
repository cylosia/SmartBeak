import './styles.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>
    <body>
    <header><h1>Affiliate Comparison</h1></header>
    <main>{children}</main>
    <footer>© ACP Theme</footer>
    </body>
  </html>
  );
}
