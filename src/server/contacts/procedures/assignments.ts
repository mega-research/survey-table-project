import * as z from 'zod';

import { loadOperationsDataScope } from '@/server/data-scope';
import { assertSurveyAccess, authed } from '@/server/orpc';

import type { ContactAssignmentMatchesResult } from '@/shared/contracts/contacts-io';

import {
  ApplyAssignmentInput,
  AssignFromListInput,
  AssignmentChangeSummarySchema,
  AssignmentFacetsInput,
  AssignmentFacetsOutput,
  AssignmentMatchesInput,
  ContactAssignmentOptionSchema,
  CreateContactAssignmentInput,
  PreviewAssignmentInput,
  ListAssignSummarySchema,
  ListContactAssignmentsInput,
  RemoveContactAssignmentInput,
  RenameContactAssignmentInput,
  ReorderContactAssignmentsInput,
  SetTargetAssignmentInput,
} from '../domain/contact-assignment';
import * as applySvc from '../services/contact-assignment-apply';
import * as facetSvc from '../services/contact-assignment-facets';
import { ForbiddenAttrColumnError } from '../services/contact-attr-values';
import * as svc from '../services/contact-assignments';

/**
 * 컨택원 배정 — 내부 실사 운영 도구라 게스트(설문 위임 클라이언트)에게 열지 않는다.
 * 베이스를 authed 로 두어 게스트는 기존 grant-first 판정으로 FORBIDDEN 이다
 * (CONTEXT.md 「컨택원」). 설문 접근 검사는 관례대로 첫 줄에 둔다.
 */

const DUPLICATE_NAME = {
  DUPLICATE_NAME: {
    status: 409,
    message: '같은 이름의 컨택원이 이미 있습니다.',
  },
} as const;

const list = authed
  .input(ListContactAssignmentsInput)
  .output(ContactAssignmentOptionSchema.array())
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    const scope = await loadOperationsDataScope(input.surveyId);
    return svc.listAssignmentOptions(input.surveyId, scope);
  });

const create = authed
  .errors(DUPLICATE_NAME)
  .input(CreateContactAssignmentInput)
  .output(ContactAssignmentOptionSchema)
  .handler(async ({ context, input, errors }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    try {
      return await svc.createAssignment(input);
    } catch (error) {
      if (error instanceof svc.DuplicateAssignmentNameError) throw errors.DUPLICATE_NAME();
      throw error;
    }
  });

/** 조사 대상 한 명의 컨택원 바꾸기 (상세 드롭다운 — 고르면 바로 저장). */
const setTarget = authed
  .input(SetTargetAssignmentInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.setTargetAssignment(input);
    return { ok: true as const };
  });

const rename = authed
  .errors(DUPLICATE_NAME)
  .input(RenameContactAssignmentInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input, errors }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    try {
      await svc.renameAssignment(input);
    } catch (error) {
      if (error instanceof svc.DuplicateAssignmentNameError) throw errors.DUPLICATE_NAME();
      throw error;
    }
    return { ok: true as const };
  });

const reorder = authed
  .input(ReorderContactAssignmentsInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.reorderAssignments(input);
    return { ok: true as const };
  });

/** 지우기 — 배정된 대상은 배정 없음이 된다. */
const remove = authed
  .input(RemoveContactAssignmentInput)
  .output(z.object({ unassigned: z.number().int() }))
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.removeAssignment(input);
  });

/** 교체 적용 미리보기 — 조건에 맞는 인원과 교체하면 바뀌는 인원 (아무것도 쓰지 않는다). */
const preview = authed
  .input(PreviewAssignmentInput)
  .output(AssignmentChangeSummarySchema)
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    const scope = await loadOperationsDataScope(input.surveyId);
    return applySvc.previewAssignment(input, scope);
  });

/** 교체 적용 — 이 컨택원의 배정을 조건 결과와 같게. 조건은 적용 시점에 다시 평가한다. */
const apply = authed
  .input(ApplyAssignmentInput)
  .output(AssignmentChangeSummarySchema)
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return applySvc.applyAssignment(input);
  });

/** 수정 화면 오른쪽 값 목록 — 체크박스형 열의 값과 명단 전체 기준 인원. */
const facets = authed
  .errors({ FORBIDDEN_COLUMN: { status: 403, message: '컬럼 스킴에 없는 컬럼입니다.' } })
  .input(AssignmentFacetsInput)
  .output(AssignmentFacetsOutput)
  .handler(async ({ context, input, errors }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    const scope = await loadOperationsDataScope(input.surveyId);
    try {
      return await facetSvc.listAssignmentFacets(input.surveyId, scope, input.source);
    } catch (error) {
      if (error instanceof ForbiddenAttrColumnError) throw errors.FORBIDDEN_COLUMN();
      throw error;
    }
  });

/** 수정 화면 오른쪽 대상 목록 — 조건에 맞는 대상 10명씩. */
const matches = authed
  .input(AssignmentMatchesInput)
  .output(z.custom<ContactAssignmentMatchesResult>())
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    const scope = await loadOperationsDataScope(input.surveyId);
    return applySvc.listAssignmentMatches(input, scope);
  });

/** 목록에서 배정 미리보기 — 검색 결과를 지금 컨택원별로 나눈 인원. */
const previewFromList = authed
  .input(AssignFromListInput)
  .output(ListAssignSummarySchema)
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    const scope = await loadOperationsDataScope(input.surveyId);
    return applySvc.previewAssignFromList(input, scope);
  });

/** 목록에서 배정 — 검색 결과를 컨택원 하나로 얹는다(null 이면 배정을 푼다). */
const assignFromList = authed
  .input(AssignFromListInput)
  .output(ListAssignSummarySchema)
  .handler(async ({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return applySvc.assignFromList(input);
  });

export const assignments = {
  list,
  create,
  rename,
  reorder,
  remove,
  setTarget,
  preview,
  apply,
  facets,
  matches,
  previewFromList,
  assignFromList,
};
