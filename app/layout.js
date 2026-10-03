import './globals.css';

export const metadata = {
  title: 'Pagewright',
  description: 'Report designer, engine and viewer',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
