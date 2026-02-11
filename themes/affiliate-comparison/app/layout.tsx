import './styles.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
  <html>
    <body>
    <header><h1>Affiliate Comparison</h1></header>
    <main>{children}</main>
    <footer>© ACP Theme</footer>
    </body>
  </html>
  );
}
