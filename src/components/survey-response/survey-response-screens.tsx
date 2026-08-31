'use client';

import { AlertCircle, ArrowLeft, CheckCircle, Loader2, Lock, Monitor } from 'lucide-react';
import Link from 'next/link';

import { formatLocalDateTime } from '@/lib/date-formatters';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * 설문 응답 흐름의 전체 화면 early-return 상태 컴포넌트들.
 * 모두 presentation 전용 — 컴포넌트 state 의존값은 prop 으로 명시 전달한다.
 * SurveyResponseFlow 의 hook 스코프 밖이므로 hook 호출 순서에 영향이 없다.
 */

// 로딩 중
export function SurveyLoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">설문을 불러오는 중...</h2>
          <p className="text-gray-600">잠시만 기다려주세요.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// 에러 발생
export function SurveyErrorScreen({
  loadError,
  onGoHome,
}: {
  loadError: string | null;
  onGoHome: () => void;
}) {
  const isPrivateError = loadError?.includes('비공개');

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          {isPrivateError ? (
            <Lock className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
          ) : (
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          )}
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            {isPrivateError ? '접근이 제한된 설문입니다' : '설문을 찾을 수 없습니다'}
          </h2>
          <p className="mb-4 text-gray-600">
            {loadError || '요청하신 설문이 존재하지 않거나 삭제되었습니다.'}
          </p>
          <Button onClick={onGoHome}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            홈으로 돌아가기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// 질문 없음
export function SurveyEmptyScreen({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">아직 질문이 없습니다</h2>
          <p className="mb-4 text-gray-600">이 설문에는 아직 질문이 등록되지 않았습니다.</p>
          <Button onClick={onGoHome}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            홈으로 돌아가기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function InvalidLinkScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-amber-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">{title}</h2>
          <p className="mb-6 text-gray-600">{body}</p>
          <Button asChild>
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              홈으로 돌아가기
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function InvalidInviteLinkScreen() {
  return (
    <InvalidLinkScreen
      title="유효하지 않은 초대 링크입니다"
      body="초대 링크가 잘못되었거나 더 이상 사용할 수 없습니다. 설문 담당자에게 문의해주세요."
    />
  );
}

export function InvalidTestLinkScreen() {
  return (
    <InvalidLinkScreen
      title="유효하지 않은 테스트 링크입니다"
      body="테스트 모드가 종료되었거나 이 링크를 더 이상 사용할 수 없습니다."
    />
  );
}

/**
 * 조사표를 함께 봐야 하는 설문의 좁은 화면 안내.
 *
 * 판정은 **뷰포트 폭**이다. User-Agent 로 판정하지 않는다 — 태블릿을 오판하고
 * 데스크톱의 좁은 창은 못 잡는다.
 *
 * 그리고 **진입 시 설문 전체를 막는다.** 분할 페이지에 도달했을 때만 막으면
 * 절반쯤 답한 시간이 버려진다.
 */
export function DesktopOnlyScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          <Monitor className="mx-auto mb-4 h-12 w-12 text-blue-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">PC 에서 열어 주세요</h2>
          <p className="text-gray-600">
            이 설문은 조사표를 나란히 보면서 판단하는 형식이라 넓은 화면이 필요합니다.
          </p>
          <p className="mt-3 text-sm text-gray-500">
            같은 링크를 PC 브라우저에서 열면 이어서 진행할 수 있습니다. 창을 넓히면
            이 화면은 바로 사라집니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// 완료 화면
export function SurveyCompletedScreen({
  thankYouMessage,
  title = '응답 완료!',
  showCompletedTime = true,
}: {
  thankYouMessage: string | null | undefined;
  title?: string;
  showCompletedTime?: boolean;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
          <h2 className="mb-2 text-2xl font-semibold text-gray-900">{title}</h2>
          <p className="mb-6 text-gray-600">
            {thankYouMessage || '설문에 참여해주셔서 감사합니다!'}
          </p>
          {showCompletedTime && (
            <div className="space-y-2 text-sm text-gray-500">
              <p>응답 완료 시간: {formatLocalDateTime(new Date())}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
