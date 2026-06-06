import { authed } from '@/server/orpc';

import {
  GetMailPreviewSampleInput,
  GetMailPreviewSampleOutput,
  SendTestTemplateMailInput,
  SendTestTemplateMailOutput,
} from '../../domain/mail-preview';
import * as svc from '../services/mail-preview.service';

/** 미리보기용 첫 컨택 샘플 조회(읽기 전용). 컨택 0건이면 null. */
const sample = authed
  .input(GetMailPreviewSampleInput)
  .output(GetMailPreviewSampleOutput)
  .handler(({ input }) => svc.getMailPreviewSample(input));

/**
 * 테스트 발송.
 * env 가드/발송 실패는 결과객체({ok:false,error})로 흘려 사용자 메시지 보존
 * (throw 하지 않음 — 원본 의미론).
 */
const testSend = authed
  .input(SendTestTemplateMailInput)
  .output(SendTestTemplateMailOutput)
  .handler(({ input }) => svc.sendTestTemplateMail(input));

export const preview = {
  sample,
  testSend,
};
