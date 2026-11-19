import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyAccessInShare, assertSurveyWriteAccess, scoped } from '@/server/orpc';

import {
  GetMailPreviewSampleInput,
  GetMailPreviewSampleOutput,
  SendTestTemplateMailInput,
  SendTestTemplateMailOutput,
} from '../domain/mail-preview';
import * as svc from '../services/preview';

/** 미리보기용 첫 컨택 샘플 조회(읽기 전용). 컨택 0건이면 null. */
const sample = scoped
  .input(GetMailPreviewSampleInput)
  .output(GetMailPreviewSampleOutput)
  .handler(({ context, input }) => {
    // 담당 범위에 묶인 게스트에게도 연다(단건 발송 미리보기) — 범위 밖 대상은 null 이다.
    const share = assertSurveyAccessInShare(context.user.id, input.surveyId);
    return svc.getMailPreviewSample(input, { isGuest: isGuestUser(context.user.id), share });
  });

/**
 * 테스트 발송.
 * env 가드/발송 실패는 결과객체({ok:false,error})로 흘려 사용자 메시지 보존
 * (throw 하지 않음 — 원본 의미론).
 * 테스트 모드가 켜진 설문이면 첫 테스트 대상자의 값과 링크로 보낸다(게스트는 종전대로).
 */
const testSend = scoped
  .input(SendTestTemplateMailInput)
  .output(SendTestTemplateMailOutput)
  .handler(({ context, input }) => {
    assertSurveyWriteAccess(context.user.id, input.surveyId);
    return svc.sendTestTemplateMail(input, { isGuest: isGuestUser(context.user.id) });
  });

export const preview = {
  sample,
  testSend,
};
