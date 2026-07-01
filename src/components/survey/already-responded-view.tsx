'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

import type { BlockReason } from '@/lib/duplicate-detection/types';

interface Props {
  reason: BlockReason;
  surveyTitle: string;
  contactEmail: string | null;
  /** quota_closed 등 설문별 커스텀 문구. 있으면 기본 body 대신 표시(줄바꿈 보존). */
  customBody?: string | null;
}

interface MessageDef {
  title: string;
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
    title: '설문이 마감되었습니다',
    body: '해당 조건의 모집이 완료되어 더 이상 참여하실 수 없습니다. 참여해 주셔서 감사합니다.',
    tone: 'info',
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
          <Icon className={`mx-auto mb-4 h-12 w-12 ${iconColor}`} />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">{msg.title}</h2>
          {surveyTitle && (
            <p className="mb-3 text-sm text-gray-500">{surveyTitle}</p>
          )}
          <p className="whitespace-pre-wrap text-gray-600">{body}</p>
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
