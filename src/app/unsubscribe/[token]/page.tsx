import type { Metadata } from 'next';

import {
  confirmUnsubscribeAction,
  revertUnsubscribeAction,
} from '@/actions/unsubscribe-actions';
import { Button } from '@/components/ui/button';
import { lookupContactByToken } from '@/features/mail/server/services/mail-unsubscribe.service';
import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';

export const metadata: Metadata = {
  title: '수신거부',
  robots: { index: false, follow: false, nocache: true },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}

export default async function UnsubscribePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = await searchParams;

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

  // GET: 컨택 lookup 만 (mutation 없음). service 직접 호출(RSC).
  const contact = await lookupContactByToken({ token });

  if (!contact.ok) {
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

  // POST 처리 완료 후 done=1 리디렉트된 상태
  if (sp.done === '1') {
    const undo = revertUnsubscribeAction.bind(null, token);
    return (
      <Layout>
        <h1 className="text-xl font-semibold text-gray-900">
          {contact.alreadyUnsubscribed
            ? '이미 수신거부 처리되었습니다'
            : '수신거부가 완료되었습니다'}
        </h1>
        <p className="mt-3 text-sm text-gray-600">
          {contact.email
            ? `${contact.email} 로의 추가 발송이 중단됩니다.`
            : '추가 발송이 중단됩니다.'}
        </p>
        <form action={undo} className="mt-6">
          <Button type="submit" variant="outline">
            실수로 누르셨나요? 되돌리기
          </Button>
        </form>
      </Layout>
    );
  }

  // GET 기본: 확인 화면
  const confirm = confirmUnsubscribeAction.bind(null, token);
  return (
    <Layout>
      <h1 className="text-xl font-semibold text-gray-900">수신거부 확인</h1>
      <p className="mt-3 text-sm text-gray-600">
        {contact.email
          ? `${contact.email} 로의 메일 수신을 거부하시겠습니까?`
          : '메일 수신을 거부하시겠습니까?'}
        <br />
        확인을 누르시면 추가 발송이 중단됩니다.
      </p>
      <form action={confirm} className="mt-6 flex gap-2">
        <Button type="submit">수신거부 확인</Button>
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
