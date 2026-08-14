import Link from 'next/link';

import { ArrowLeft, LogOut, ShieldAlert } from 'lucide-react';

import { logout } from '@/actions/auth-actions';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { getGuestSurveyId } from '@/lib/auth/guest-grants';

/**
 * 게스트 계정 안내 페이지.
 *
 * 게스트(설문 단위 grant)가 자기 grant 밖 설문의 운영 콘솔 URL 로 진입하면
 * 미들웨어(guestPathRedirect)가 여기로 보낸다. 조용히 자기 설문으로 돌리는 대신
 * 계정을 바꿔 로그인해야 함을 명시해 "링크가 깨졌다"는 오해를 막는다.
 */
export default async function NoAccessPage() {
  const user = await getCurrentUser();
  const grantedSurveyId = user ? getGuestSurveyId(user.id) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="mt-4 text-lg font-semibold text-gray-900">
          접근 권한이 없는 설문입니다
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          지금 로그인된 계정으로는 이 설문의 운영 콘솔에 들어갈 수 없습니다.
          로그아웃 후 해당 설문 담당 계정으로 다시 로그인해 주세요.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <form action={logout}>
            <Button className="w-full">
              <LogOut className="mr-2 h-4 w-4" />
              로그아웃하고 계정 바꾸기
            </Button>
          </form>
          {grantedSurveyId && (
            <Link href={`/admin/surveys/${grantedSurveyId}/operations/overview`}>
              <Button variant="outline" className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                내 설문 현황으로 돌아가기
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
