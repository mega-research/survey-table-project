import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyAccess, assertSurveyWriteAccess, scoped } from '@/server/orpc';
import { sendTestTemplateMailWithLiveLink } from '@/server/workflows/test-send-live-link';

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
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.getMailPreviewSample(input);
  });

/**
 * 테스트 발송.
 * env 가드/발송 실패는 결과객체({ok:false,error})로 흘려 사용자 메시지 보존
 * (throw 하지 않음 — 원본 의미론).
 * 테스트 모드가 켜진 설문이면 초대 링크를 눌러서 열리는 테스트 대상자 링크로 넣는다 —
 * contacts(테스트 사본 대상자)와 mail(발송)을 잇는 워크플로에 위임한다.
 */
const testSend = scoped
  .input(SendTestTemplateMailInput)
  .output(SendTestTemplateMailOutput)
  .handler(({ context, input }) => {
    assertSurveyWriteAccess(context.user.id, input.surveyId);
    return sendTestTemplateMailWithLiveLink(input, isGuestUser(context.user.id));
  });

export const preview = {
  sample,
  testSend,
};
