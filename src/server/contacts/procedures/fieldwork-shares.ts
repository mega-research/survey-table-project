import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import type { FieldworkShareMatchesResult } from '@/shared/contracts/contacts-io';

import { AssignmentFacetsOutput } from '../domain/contact-assignment';
import {
  FieldworkShareApplyInput,
  FieldworkShareApplyOutput,
  FieldworkShareChangeSummarySchema,
  FieldworkShareClausesInput,
  FieldworkShareClearOutput,
  FieldworkShareFacetsInput,
  FieldworkShareListInput,
  FieldworkShareListOutput,
  FieldworkShareMatchesInput,
  FieldworkShareTargetInput,
} from '../domain/fieldwork-share';
import { listAssignmentFacets } from '../services/contact-assignment-facets';
import { ForbiddenAttrColumnError } from '../services/contact-attr-values';
import * as svc from '../services/fieldwork-shares';

/**
 * 외주 담당 범위 나누기 (ADR-0035, fieldwork-multi-company 티켓 03).
 *
 * **관문은 전부 `survey.manageAccess`** — 링크를 발급하는 사람과 같다(소유자·소유 팀 팀장·슈퍼어드민).
 * 컨택원을 나눌 수 있는 사내 실사원(전체 권한 참여자 — `contacts.manage` 는 있고 `survey.manageAccess` 는
 * 없다)은 거부된다: 외부인이 볼 연락처를 정하는 일이라서다. 베이스가 `authed`(내부 계정 전용)라 링크
 * 주체는 관문 전에 UNAUTHORIZED 다 — 자기 링크의 범위를 스스로 넓힐 수 없다.
 *
 * 범위는 **실데이터에만** 선다 — 브라우저의 테스트 보기와 무관하다(서비스가 고정한다).
 * 입력의 최상위 `linkId` 는 rpc 로그가 `targetLinkId` 로 싣는다. 조건 값(ID 목록)은 싣지 않는다.
 */
const list = authed
  .input(FieldworkShareListInput)
  .output(FieldworkShareListOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.listFieldworkShares(input.surveyId);
  });

/** 미리보기 — 조건 인원·이 링크에서 바뀌는 인원·다른 링크에 이미 있는 인원(링크별). 쓰지 않는다. */
const preview = authed
  .input(FieldworkShareClausesInput)
  .output(FieldworkShareChangeSummarySchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.previewFieldworkShare(input);
  });

/**
 * 적용 — 이 링크의 범위를 조건 결과와 같게, 겹치는 대상은 고른 처리(`overlap`, 필수)대로. 조건은 적용
 * 시점에 다시 계산한다.
 */
const apply = authed
  .input(FieldworkShareApplyInput)
  .output(FieldworkShareApplyOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.applyFieldworkShare(input);
  });

/** 담당 범위 없애기 — 이 링크가 다시 설문 전체를 본다. */
const clear = authed
  .input(FieldworkShareTargetInput)
  .output(FieldworkShareClearOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.clearFieldworkShare(input);
  });

/** 수정 화면 오른쪽 대상 목록 — 조건에 맞는 대상 10명씩과 그 대상이 지금 속한 링크. */
const matches = authed
  .input(FieldworkShareMatchesInput)
  .output(z.custom<FieldworkShareMatchesResult>())
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.listFieldworkShareMatches(input);
  });

/**
 * 수정 화면 오른쪽 값 목록 — 컨택원 수정 화면과 같은 집계(명단 전체 기준 인원, 실데이터). 관문만 다르다:
 * `contacts.assignments.facets` 는 `contacts.manage` 라 담당 범위 화면이 부르면 권한 축이 섞인다.
 */
const facets = authed
  .errors({ FORBIDDEN_COLUMN: { status: 403, message: '컬럼 스킴에 없는 컬럼입니다.' } })
  .input(FieldworkShareFacetsInput)
  .output(AssignmentFacetsOutput)
  .handler(async ({ context, input, errors }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    try {
      return await listAssignmentFacets(input.surveyId, 'real', input.source);
    } catch (error) {
      if (error instanceof ForbiddenAttrColumnError) throw errors.FORBIDDEN_COLUMN();
      throw error;
    }
  });

export const fieldworkShares = {
  list,
  preview,
  apply,
  clear,
  matches,
  facets,
};
