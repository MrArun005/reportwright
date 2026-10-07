import './globals.css';
import { THEME_BOOT } from '@/theme/theme.js';

export const metadata = {
  title: 'ReportWright',
  description: 'Report designer, engine and viewer',
};

export default function RootLayout({ children }) {
  return (
    // data-theme is set before first paint by THEME_BOOT, so React must not warn about it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
