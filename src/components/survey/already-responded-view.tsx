'use client';

import Link from 'next/link';

import type { BlockReason } from '@/lib/duplicate-detection/types';

interface Props {
  reason: BlockReason;
  surveyTitle: string;
  contactEmail: string | null;
}

const MESSAGES: Record<BlockReason, { title: string; body: string }> = {
  invalid_token: {
    title: '잘못된 초대 링크입니다',
    body: '이 링크는 유효하지 않거나 만료되었습니다. 운영자에게 문의해 주세요.',
  },
  token_already_used: {
    title: '이미 응답하신 설문입니다',
    body: '이미 응답이 제출되었습니다. 운영자에게 문의해 주세요.',
  },
  device_already_responded: {
    title: '이미 응답하신 설문입니다',
    body: '이 기기에서 이 설문에 응답한 기록이 있습니다. 한 분당 한 번만 응답 가능합니다.',
  },
};

export function AlreadyRespondedView({ reason, surveyTitle, contactEmail }: Props) {
  const msg = MESSAGES[reason];
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">{msg.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{surveyTitle}</p>
      <p className="mt-6 text-sm leading-relaxed text-foreground">{msg.body}</p>
      {contactEmail && (
        <Link
          href={`mailto:${contactEmail}?subject=${encodeURIComponent(surveyTitle + ' 문의')}`}
          className="mt-8 text-sm text-primary underline"
        >
          관리자에게 문의하기
        </Link>
      )}
    </div>
  );
}
