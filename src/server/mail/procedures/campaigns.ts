import * as z from 'zod';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';
import {
  assertSurveyAccess,
  assertSurveyWriteAccess,
  assertSurveyWriteAccessInShare,
  scoped,
} from '@/server/orpc';

import {
  CancelCampaignInput,
  CreateCampaignInput,
  CreateCampaignResult,
  FetchCandidateIdsInput,
  FetchCandidateIdsResult,
  PreviewPreflightInput,
  PreviewPreflightResult,
  ResyncCampaignInput,
  ResyncCampaignResult,
  SendSingleCampaignInput,
} from '../domain/mail-campaign';
import * as svc from '../services/campaigns';
import { sendSingleCampaign } from '../services/single-send';

const create = scoped
  .input(CreateCampaignInput)
  .output(CreateCampaignResult)
  .handler(({ context, input }) => {
    assertSurveyWriteAccess(context.user.id, input.surveyId);
    // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
    // 단체 발송은 담당 범위에 묶인 게스트에게 닫혀 있다(위 확인이 거부한다) — 여기 오는 발송자는 전체를 본다.
    return svc.createCampaign(input, context.user.id, isGuestUser(context.user.id), {
      share: FIELDWORK_SHARE_ALL,
    });
  });

const cancel = scoped
  .input(CancelCampaignInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyWriteAccess(context.user.id, input.surveyId);
    await svc.cancelCampaign(input, isGuestUser(context.user.id));
    return { ok: true as const };
  });

const resync = scoped
  .input(ResyncCampaignInput)
  .output(ResyncCampaignResult)
  .handler(({ context, input }) => {
    assertSurveyWriteAccess(context.user.id, input.surveyId);
    return svc.resyncCampaign(input);
  });

const fetchCandidateIds = scoped
  .input(FetchCandidateIdsInput)
  .output(FetchCandidateIdsResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.fetchCandidateIds(input, isGuestUser(context.user.id));
  });

const previewPreflight = scoped
  .input(PreviewPreflightInput)
  .output(PreviewPreflightResult)
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.previewPreflight(input);
  });

const sendSingle = scoped
  .input(SendSingleCampaignInput)
  .output(CreateCampaignResult)
  .handler(({ context, input }) => {
    // 담당 범위에 묶인 게스트에게도 연다 — 범위 밖 대상은 서비스가 NOT_FOUND 로 접는다.
    // (단체 발송 create 는 범위를 거르지 않아 범위 게스트에게 닫혀 있다.)
    const share = assertSurveyWriteAccessInShare(context.user.id, input.surveyId);
    return sendSingleCampaign(input, context.user.id, isGuestUser(context.user.id), share);
  });

export const campaigns = {
  create,
  cancel,
  resync,
  fetchCandidateIds,
  previewPreflight,
  sendSingle,
};
