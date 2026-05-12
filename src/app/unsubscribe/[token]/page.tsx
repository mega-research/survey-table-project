import type { Metadata } from 'next';

import {
  revertUnsubscribeAction,
  unsubscribeByToken,
} from '@/actions/unsubscribe-actions';
import { Button } from '@/components/ui/button';
import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';

export const metadata: Metadata = {
  title: '수신거부',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function UnsubscribePage({ params }: PageProps) {
  const { token } = await params;

  if (token === UNSUBSCRIBE_SANDBOX_TOKEN) {
    return (
      <Layout>
        <h1 className="text-xl font-semibold text-gray-900">테스트 발송 미리보기</h1>
        <p className="mt-3 text-sm text-gray-600">
          이 링크는 템플릿 테스트 발송에 포함된 sandbox 링크입니다.
          <br />
          실제 수신거부는 처리되지 않으며, 진짜 발송 시에는 컨택별로 다른 링크가 생성됩니다.
        </p>
      </Layout>
    );
  }

  const result = await unsubscribeByToken(token);

  if (!result.ok) {
    return (
      <Layout>
        <h1 className="text-xl font-semibold text-gray-900">유효하지 않은 링크</h1>
        <p className="mt-3 text-sm text-gray-600">
          수신거부 링크가 만료되었거나 잘못된 형식입니다. 메일에 포함된 원본 링크를 다시
          확인해 주세요.
        </p>
      </Layout>
    );
  }

  const undo = revertUnsubscribeAction.bind(null, token);

  return (
    <Layout>
      <h1 className="text-xl font-semibold text-gray-900">
        {result.alreadyUnsubscribed
          ? '이미 수신거부 처리되었습니다'
          : '수신거부가 완료되었습니다'}
      </h1>
      <p className="mt-3 text-sm text-gray-600">
        {result.email
          ? `${result.email} 로의 추가 발송이 중단됩니다.`
          : '추가 발송이 중단됩니다.'}
        <br />
        앞으로 이 설문 관련 메일을 받지 않으시게 됩니다.
      </p>
      <form action={undo} className="mt-6">
        <Button type="submit" variant="outline">
          실수로 누르셨나요? 되돌리기
        </Button>
      </form>
    </Layout>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}
