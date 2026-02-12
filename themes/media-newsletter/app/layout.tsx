import './styles.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
  <html lang="en">
    <head><meta charSet="utf-8" /></head>
    <body>
    <header><h1>Media Newsletter</h1></header>
    <main>{children}</main>
    <footer>© ACP Theme</footer>
    </body>
  </html>
  );
}
