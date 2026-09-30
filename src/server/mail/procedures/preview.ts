import { scoped } from '@/server/orpc';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  GetContactMailPreviewSampleInput,
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
    await assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, 'mail.view');
    return svc.getMailPreviewSample(input);
  });

/**
 * 단건 발송 창의 미리보기 — 보낼 사람 한 명만 본다 (ADR-0027).
 *
 * `sample` 과 가른 이유는 요구 칸이 달라서다. 외주 실사 링크는 메일 탭(`mail.view`)이 없고
 * 단건 발송(`mail.sendSingle`)만 갖는다. 대상 지목이 필수라 「첫 컨택」 폴백이 없고, 대상은
 * 그 링크가 이미 원본으로 보는 조사 대상(`contacts.view`)이라 새로 열리는 정보가 없다.
 */
const contactSample = scoped
  .input(GetContactMailPreviewSampleInput)
  .output(GetMailPreviewSampleOutput)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, 'mail.sendSingle');
    return svc.getMailPreviewSample(input, context.actor);
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
    await assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, 'mail.send');
    return svc.sendTestTemplateMail(input);
  });

export const preview = {
  sample,
  contactSample,
  testSend,
};
