'use server';

import { requireAuth } from '@/lib/auth';
import { getFirstContactSample } from '@/lib/operations/contact-sample.server';

export interface MailPreviewSample {
  attrs: Record<string, string>;
  inviteUrl: string;
  email: string | null;
  resid: number;
}

interface ActionResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * 메일 템플릿 미리보기용 — 해당 설문의 첫 컨택 1건 샘플.
 * inviteUrl 은 NEXT_PUBLIC_APP_URL 기준으로 서버에서 빌드 (window.origin 사용 시
 * localhost 미리보기 / 실제 발송 도메인 불일치 문제 발생).
 */
export async function getMailPreviewSampleAction(
  surveyId: string,
): Promise<ActionResult<MailPreviewSample | null>> {
  await requireAuth();
  const sample = await getFirstContactSample(surveyId);
  if (!sample) return { ok: true, data: null };

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  const inviteUrl = `${baseUrl}/survey/${surveyId}?invite=${sample.inviteToken}`;

  return {
    ok: true,
    data: {
      attrs: sample.attrs,
      inviteUrl,
      email: sample.email,
      resid: sample.resid,
    },
  };
}
