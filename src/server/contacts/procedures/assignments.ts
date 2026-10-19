import * as z from 'zod';

import { loadOperationsDataScope } from '@/server/data-scope';
import { assertSurveyAccess, authed } from '@/server/orpc';

import {
  ContactAssignmentOptionSchema,
  CreateContactAssignmentInput,
  ListContactAssignmentsInput,
  RemoveContactAssignmentInput,
  RenameContactAssignmentInput,
  ReorderContactAssignmentsInput,
  SetTargetAssignmentInput,
} from '../domain/contact-assignment';
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

export const assignments = {
  list,
  create,
  rename,
  reorder,
  remove,
  setTarget,
};
