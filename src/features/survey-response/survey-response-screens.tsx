'use client';

import type { ReactNode } from 'react';

import { AlertCircle, ArrowLeft, CheckCircle, Loader2, Lock, Monitor } from 'lucide-react';
import Link from 'next/link';

import { formatLocalDateTime } from '@/lib/date-formatters';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import type { SystemStringKey } from '@/utils/system-strings';

import { SystemText } from './system-text';

/**
 * 설문 응답 흐름의 전체 화면 early-return 상태 컴포넌트들.
 * 모두 presentation 전용 — 컴포넌트 state 의존값은 prop 으로 명시 전달한다.
 * SurveyResponseFlow 의 hook 스코프 밖이므로 hook 호출 순서에 영향이 없다.
 *
 * 다국어 설문(CONTEXT.md 「다국어 설문」)이면 `locale` 로 현재 언어를 받는다. 미정(`null`)이면
 * 세 언어를 위아래로 함께 보인다. 기본은 한국어 — 설문을 모르는 자리(라우트 로딩·짧은 링크)와
 * 다국어 아닌 설문은 지금 글자 그대로다.
 */

type ScreenLocale = SurveyLocale | null;

// 로딩 중
export function SurveyLoadingScreen({ locale = DEFAULT_SURVEY_LOCALE }: { locale?: ScreenLocale }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            <SystemText k="screen.loading.title" locale={locale} />
          </h2>
          <p className="text-gray-600">
            <SystemText k="screen.loading.body" locale={locale} />
          </p>
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

function InvalidLinkScreen({
  title,
  body,
  locale,
}: {
  title: SystemStringKey;
  body: SystemStringKey;
  locale: ScreenLocale;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-amber-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            <SystemText k={title} locale={locale} />
          </h2>
          <p className="mb-6 text-gray-600">
            <SystemText k={body} locale={locale} />
          </p>
          <Button asChild>
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              <SystemText k="screen.goHome" locale={locale} />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function InvalidInviteLinkScreen({
  locale = DEFAULT_SURVEY_LOCALE,
}: {
  locale?: ScreenLocale;
}) {
  return (
    <InvalidLinkScreen
      title="screen.invalidInviteLink.title"
      body="screen.invalidInviteLink.body"
      locale={locale}
    />
  );
}

/**
 * 공개 진입 라우트의 rate limit 차단 화면.
 *
 * 링크 자체는 유효하므로 "유효하지 않은 링크" 로 말하면 응답자가 담당자에게 링크를
 * 다시 요청하게 된다. 잠시 뒤 다시 열면 된다는 것을 알려야 한다.
 */
export function TooManyRequestsScreen({
  locale = DEFAULT_SURVEY_LOCALE,
}: {
  locale?: ScreenLocale;
}) {
  return (
    <InvalidLinkScreen
      title="screen.tooManyRequests.title"
      body="screen.tooManyRequests.body"
      locale={locale}
    />
  );
}

export function InvalidTestLinkScreen({
  locale = DEFAULT_SURVEY_LOCALE,
}: {
  locale?: ScreenLocale;
}) {
  return (
    <InvalidLinkScreen
      title="screen.invalidTestLink.title"
      body="screen.invalidTestLink.body"
      locale={locale}
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
export function DesktopOnlyScreen({ locale = DEFAULT_SURVEY_LOCALE }: { locale?: ScreenLocale }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          <Monitor className="mx-auto mb-4 h-12 w-12 text-blue-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            <SystemText k="screen.desktopOnly.title" locale={locale} />
          </h2>
          <p className="text-gray-600">
            <SystemText k="screen.desktopOnly.body" locale={locale} />
          </p>
          <p className="mt-3 text-sm text-gray-500">
            <SystemText k="screen.desktopOnly.hint" locale={locale} />
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// 완료 화면
export function SurveyCompletedScreen({
  thankYouMessage,
  title,
  showCompletedTime = true,
  footer,
  locale = DEFAULT_SURVEY_LOCALE,
}: {
  thankYouMessage: string | null | undefined;
  /** 비우면 시스템 문장 「응답 완료!」(현재 언어). */
  title?: string;
  locale?: ScreenLocale;
  showCompletedTime?: boolean;
  /** 카드 맨 아래 — 종료 후 이동 안내(EndRedirectNotice) 자리. */
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
          <h2 className="mb-2 text-2xl font-semibold text-gray-900">
            {title ?? <SystemText k="completion.title" locale={locale} />}
          </h2>
          <p className="mb-6 text-gray-600">
            {thankYouMessage || <SystemText k="completion.defaultMessage" locale={locale} />}
          </p>
          {showCompletedTime && (
            <div className="space-y-2 text-sm text-gray-500">
              <p>
                <SystemText
                  k="completion.completedAt"
                  locale={locale}
                  values={{ time: formatLocalDateTime(new Date()) }}
                />
              </p>
            </div>
          )}
          {footer}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 종료 후 이동 중 화면 (패널 연동). 실응답이 종료 주소로 가는 동안 완료 카드 대신 이것만 그린다 —
 * 패널 종료 페이지가 열리기 전 잠깐 「응답 완료」가 비치면 응답자가 거기서 창을 닫는다.
 * 이동이 막힌 경우를 위해 손으로 누를 링크를 남긴다.
 */
export function EndRedirectingScreen({
  url,
  locale = DEFAULT_SURVEY_LOCALE,
}: {
  url: string;
  locale?: ScreenLocale;
}) {
  // 한 문장 안에 링크가 끼므로 미정이면 한국어 — 이 화면은 응답을 마친 뒤라 언어가 정해져 있다
  const lineLocale = locale ?? DEFAULT_SURVEY_LOCALE;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-hidden />
      <p className="text-gray-700">
        <SystemText k="endRedirect.waiting" locale={lineLocale} />
      </p>
      <p className="text-sm text-gray-500">
        <SystemText k="endRedirect.fallbackBefore" locale={lineLocale} />
        <a href={url} className="font-medium text-blue-600 underline">
          <SystemText k="endRedirect.fallbackLink" locale={lineLocale} />
        </a>
        <SystemText k="endRedirect.fallbackAfter" locale={lineLocale} />
      </p>
    </div>
  );
}

/**
 * 종료 후 이동 안내 (패널 연동) — 테스트·미리보기는 패널 집계에 잡히지 않게 이동하지 않고
 * 완료 화면 아래에 어디로 갈지만 보인다. 실응답은 EndRedirectingScreen 이 대신 선다.
 */
export function EndRedirectNotice({
  url,
  locale = DEFAULT_SURVEY_LOCALE,
}: {
  url: string;
  locale?: ScreenLocale;
}) {
  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
      <p>
        <SystemText k="endRedirect.testNotice" locale={locale} />
      </p>
      <p className="mt-1 font-medium break-all text-gray-900">{url}</p>
    </div>
  );
}
