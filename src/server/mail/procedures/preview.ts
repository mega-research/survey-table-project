import { scoped } from '@/server/orpc';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

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
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.view');
    return svc.getMailPreviewSample(input);
  });

/**
 * 테스트 발송.
 * env 가드/발송 실패는 결과객체({ok:false,error})로 흘려 사용자 메시지 보존
 * (throw 하지 않음 — 원본 의미론).
 */
const testSend = scoped
  .input(SendTestTemplateMailInput)
  .output(SendTestTemplateMailOutput)
  .handler(async ({ context, input }) => {
    // 테스트 발송도 실제 메일이 나간다 — 열람(mail.view)이 아니라 발송 권한을 요구한다.
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'mail.send');
    return svc.sendTestTemplateMail(input);
  });

export const preview = {
  sample,
  testSend,
};
