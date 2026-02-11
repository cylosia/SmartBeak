import './styles.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
  <html>
    <body>
    <header><h1>Landing Leadgen</h1></header>
    <main>{children}</main>
    <footer>© ACP Theme</footer>
    </body>
  </html>
  );
}
