import { ORPCError } from '@orpc/server';

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
 *
 * **지목한 대상이 없으면 NOT_FOUND 다** (fieldwork-multi-company 티켓 05). 단건 발송 창은 대상 상세에서만
 * 열리므로 「대상이 없다」는 정상 응답이 아니다 — 없는 대상·남의 설문 대상·담당 범위 밖 대상을 같은
 * 답(단건 발송의 첫 거부와 같은 문구)으로 접어 존재를 드러내지 않는다.
 */
const contactSample = scoped
  .input(GetContactMailPreviewSampleInput)
  .output(GetMailPreviewSampleOutput)
  .handler(async ({ context, input }) => {
    await assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, 'mail.sendSingle');
    const sample = await svc.getMailPreviewSample(input, context.actor);
    if (!sample) throw new ORPCError('NOT_FOUND', { message: '조사 대상을 찾을 수 없습니다.' });
    return sample;
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
