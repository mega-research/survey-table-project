import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

import { GlobalErrorDialog } from '@/components/ui/global-error-dialog';
import { QueryProvider } from '@/components/providers/query-provider';

import './globals.css';

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '메가리서치 - 정부와 기업의 의사결정을 돕는 네비게이터',
  description:
    '정부와 기업의 의사결정을 돕는 네비게이터. 메가리서치는 전문성과 신뢰를 바탕으로 정확한 조사·분석 데이터를 제공합니다.',
  keywords: ['메가리서치', '리서치', '조사분석', '설문조사', '여론조사', '데이터 분석', 'survey', 'research'],
  authors: [{ name: '메가리서치' }],
  robots: 'index, follow',
  openGraph: {
    title: '메가리서치',
    description: '정부와 기업의 의사결정을 돕는 네비게이터',
    siteName: '메가리서치',
    type: 'website',
    locale: 'ko_KR',
  },
  twitter: {
    card: 'summary',
    title: '메가리서치',
    description: '정부와 기업의 의사결정을 돕는 네비게이터',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.1/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css"
        />
      </head>
      <body className={`${geistMono.variable} antialiased`} suppressHydrationWarning={true}>
        <QueryProvider>
          {children}
          <GlobalErrorDialog />
          <Toaster
            position="top-right"
            gap={8}
            toastOptions={{
              style: {
                border: '1px solid #e0e0e0',
                borderRadius: '12px',
                color: '#1d1d1f',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
              },
            }}
          />
        </QueryProvider>
      </body>
    </html>
  );
}
