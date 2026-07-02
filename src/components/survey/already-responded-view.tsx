'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

import type { BlockReason } from '@/lib/duplicate-detection/types';
import { DEFAULT_PAUSED_MESSAGE } from '@/shared/lib/survey-control';
import { cn } from '@/lib/utils';

interface Props {
  reason: BlockReason;
  surveyTitle: string;
  contactEmail: string | null;
  /** quota_closed 등 설문별 커스텀 문구. 있으면 기본 body 대신 표시(줄바꿈 보존). */
  customBody?: string | null;
}

interface MessageDef {
  /** null = 제목 없이 body만 크게 표시 (quota_closed — 커스텀 문구가 주인공). */
  title: string | null;
  body: string;
  tone: 'error' | 'info';
}

const MESSAGES: Record<BlockReason, MessageDef> = {
  invalid_token: {
    title: '잘못된 초대 링크입니다',
    body: '이 링크는 유효하지 않거나 만료되었습니다. 운영자에게 문의해 주세요.',
    tone: 'error',
  },
  token_already_used: {
    title: '이미 응답하신 설문입니다',
    body: '이 초대 링크로는 이미 응답이 제출되었습니다. 중복 응답은 허용되지 않습니다.',
    tone: 'info',
  },
  device_already_responded: {
    title: '이미 응답하신 설문입니다',
    body: '이 기기에서 이 설문에 응답한 기록이 있습니다. 한 분당 한 번만 응답 가능합니다.',
    tone: 'info',
  },
  excluded_from_population: {
    // 카피는 token_already_used 와 의도적으로 유사 — PII 보안 [수신거부/콜센터 노트 추정 차단]
    title: '이미 응답하신 설문입니다',
    body: '이 초대 링크로는 더 이상 응답을 받지 않습니다. 운영자에게 문의해 주세요.',
    tone: 'info',
  },
  quota_closed: {
    // 기본 제목 멘트 없이 운영자가 입력한 마감 안내 문구만 표시 (2026-07-02 운영 피드백).
    title: null,
    body: '해당 조건의 모집이 완료되어 더 이상 참여하실 수 없습니다. 참여해 주셔서 감사합니다.',
    tone: 'info',
  },
  survey_paused: {
    // quota_closed 와 동일하게 제목 없이 운영자가 입력한 중단 문구(customBody)만 크게 표시.
    // customBody 미전달 시 기본 중단 문구로 폴백.
    title: null,
    body: DEFAULT_PAUSED_MESSAGE,
    tone: 'info',
  },
  invalid_test_token: {
    title: '테스트 링크가 유효하지 않습니다',
    body: '테스트 모드가 꺼져 있거나 링크가 잘못되었습니다. 운영 콘솔에서 테스트 링크를 다시 복사해 주세요.',
    tone: 'error',
  },
};

export function AlreadyRespondedView({ reason, surveyTitle, contactEmail, customBody }: Props) {
  const msg = MESSAGES[reason];
  const Icon = msg.tone === 'error' ? AlertCircle : CheckCircle2;
  const iconColor = msg.tone === 'error' ? 'text-red-500' : 'text-blue-500';
  const body = customBody && customBody.trim() ? customBody : msg.body;

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
          {msg.title && <h2 className="mb-2 text-xl font-semibold text-gray-900">{msg.title}</h2>}
          {surveyTitle && msg.title !== null && (
            <p className="mb-3 text-sm text-gray-500">{surveyTitle}</p>
          )}
          <p
            className={cn(
              'whitespace-pre-wrap',
              msg.title ? 'text-gray-600' : 'text-lg leading-relaxed text-gray-800',
            )}
          >
            {body}
          </p>
          {contactEmail && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
              <p className="text-gray-500">문의 이메일</p>
              <p className="mt-1 font-medium break-all text-gray-900">{contactEmail}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
