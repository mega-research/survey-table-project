'use client';

import { AlertCircle, ArrowLeft, CheckCircle, Loader2, Lock } from 'lucide-react';

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
