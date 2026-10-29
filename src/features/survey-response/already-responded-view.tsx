'use client';

import type { ReactNode } from 'react';

import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

import type { BlockReason } from '@/lib/duplicate-detection/types';
import { cn } from '@/lib/utils';
import { DEFAULT_PAUSED_MESSAGE } from '@/shared/lib/survey-control';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import type { SystemStringKey } from '@/utils/system-strings';

import { SystemText } from './system-text';

/**
 * 세션 도중 이 응답이 (다른 화면 또는 재시도로) 이미 완료된 것을 발견했을 때의 안내 —
 * 서버 BlockReason 에는 없는 클라이언트 전용 사유라 여기서 union 을 넓힌다.
 */
export type NoticeReason = BlockReason | 'response_concluded' | 'test_version_republished';

interface Props {
  reason: NoticeReason;
  surveyTitle: string;
  contactEmail: string | null;
  /** quota_closed 등 설문별 커스텀 문구. 있으면 기본 body 대신 표시(줄바꿈 보존). */
  customBody?: string | null;
  /** 카드 맨 아래 — 종료 후 이동 안내(EndRedirectNotice) 자리. */
  footer?: ReactNode;
  /**
   * 시스템 문장의 언어 (CONTEXT.md 「다국어 설문」). 미정(`null`)이면 세 언어를 함께 보인다 —
   * 응답 행이 없어 언어 문항의 답을 읽지 못한 재진입. 저작자 문구(customBody)·설문 제목은 그대로.
   */
  locale?: SurveyLocale | null;
}

interface MessageDef {
  /** null = 제목 없이 body만 크게 표시 (quota_closed — 커스텀 문구가 주인공). */
  title: SystemStringKey | null;
  body: SystemStringKey;
  tone: 'error' | 'info';
}

const MESSAGES: Record<NoticeReason, MessageDef> = {
  test_version_republished: {
    // 테스트 응답 전용 — 실응답은 버전 정리가 보존해 이 사유에 오지 않는다. 테스트 중 저장본이 바뀌어
    // 새 테스트 버전이 생기면 옛 테스트 버전 위의 저장이 여기로 온다(CONTEXT.md 「테스트 버전」).
    // 새로고침하면 재개 이관(ADR-0014)이 새 버전으로 옮기고 바뀐 곳으로 데려간다.
    title: 'notice.testVersionRepublished.title',
    body: 'notice.testVersionRepublished.body',
    tone: 'info',
  },
  response_concluded: {
    title: 'notice.responseConcluded.title',
    body: 'notice.responseConcluded.body',
    tone: 'info',
  },
  invalid_token: {
    title: 'notice.invalidToken.title',
    body: 'notice.invalidToken.body',
    tone: 'error',
  },
  token_already_used: {
    title: 'notice.alreadyResponded.title',
    body: 'notice.tokenAlreadyUsed.body',
    tone: 'info',
  },
  device_already_responded: {
    title: 'notice.alreadyResponded.title',
    body: 'notice.deviceAlreadyResponded.body',
    tone: 'info',
  },
  quota_closed: {
    // 기본 제목 멘트 없이 운영자가 입력한 마감 안내 문구만 표시 (2026-07-02 운영 피드백).
    title: null,
    body: 'default.quotaClosed',
    tone: 'info',
  },
  survey_paused: {
    // quota_closed 와 동일하게 제목 없이 운영자가 입력한 중단 문구(customBody)만 크게 표시.
    // customBody 미전달 시 기본 중단 문구로 폴백.
    title: null,
    body: 'default.paused',
    tone: 'info',
  },
  invalid_test_token: {
    title: 'notice.invalidTestToken.title',
    body: 'notice.invalidTestToken.body',
    tone: 'error',
  },
  not_accepting: {
    // 미배포·마감·정원·버전 불일치를 하나로 접은 사유. 응답자에게 내부 상태를 세분해
    // 알리지 않는다 — 어느 쪽이든 지금 응답할 수 없다는 사실은 같다.
    title: 'notice.notAccepting.title',
    body: 'notice.notAccepting.body',
    tone: 'info',
  },
};

/**
 * 운영자 문구 — 비면 시스템 기본 문구(현재 언어)로 폴백한다. 운영 콘솔의 중단 다이얼로그는
 * 한국어 기본 문구를 미리 채워 그대로 저장하므로, 중단 문구가 그 기본 문구와 같으면 운영자가 쓴
 * 글이 아니라 기본값으로 보고 비운다 — 다국어 설문에서 고른 언어의 기본 문구가 나오게.
 * 한국어 화면은 같은 글자가 같은 자리에 나와 달라지지 않는다.
 */
function resolveCustomBody(reason: NoticeReason, customBody: string | null | undefined) {
  if (!customBody || !customBody.trim()) return null;
  if (reason === 'survey_paused' && customBody.trim() === DEFAULT_PAUSED_MESSAGE) return null;
  return customBody;
}

export function AlreadyRespondedView({
  reason,
  surveyTitle,
  contactEmail,
  customBody,
  footer,
  locale = DEFAULT_SURVEY_LOCALE,
}: Props) {
  const msg = MESSAGES[reason];
  const Icon = msg.tone === 'error' ? AlertCircle : CheckCircle2;
  const iconColor = msg.tone === 'error' ? 'text-red-500' : 'text-blue-500';
  const customText = resolveCustomBody(reason, customBody);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          {/* 제목 없는 케이스(quota_closed)는 에디터 미리보기와 동일한 배지 아이콘 + 문구만 */}
          {msg.title === null ? (
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
              <Icon className={`h-6 w-6 ${iconColor}`} />
            </div>
          ) : (
            <Icon className={`mx-auto mb-4 h-12 w-12 ${iconColor}`} />
          )}
          {msg.title && (
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              <SystemText k={msg.title} locale={locale} />
            </h2>
          )}
          {/* 다국어 설문의 미정 제목은 언어마다 한 줄 — 줄바꿈을 살린다 */}
          {surveyTitle && msg.title !== null && (
            <p className="mb-3 text-sm whitespace-pre-line text-gray-500">{surveyTitle}</p>
          )}
          <p
            className={cn(
              'whitespace-pre-wrap',
              msg.title ? 'text-gray-600' : 'text-lg leading-relaxed text-gray-800',
            )}
          >
            {customText ?? <SystemText k={msg.body} locale={locale} />}
          </p>
          {contactEmail && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
              <p className="text-gray-500">
                <SystemText k="notice.contactEmail" locale={locale} />
              </p>
              <p className="mt-1 font-medium break-all text-gray-900">{contactEmail}</p>
            </div>
          )}
          {footer}
        </CardContent>
      </Card>
    </div>
  );
}
