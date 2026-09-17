import type { Metadata } from 'next';

/**
 * 공개 응답 라우트 noindex.
 *
 * 루트 layout 의 robots: 'index, follow' 를 응답 URL(슬러그·privateToken)이 그대로
 * 상속하면 설문 링크가 검색엔진에 색인된다. page.tsx 가 'use client' 라 metadata 를
 * export 할 수 없어 layout 에서 덮는다. robots 값은 /preview/[token] 과 같지만 그쪽은
 * page 자체가 server component 라 page 에서 직접 export 한다.
 *
 * robots 만 선언하므로 title/description/openGraph 는 루트 metadata 를 그대로 상속한다.
 * 렌더 트리는 children 통과라 응답 화면 동작에 영향이 없다.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SurveyResponseLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
