import * as z from 'zod';

import { AssignmentClausesSchema } from './contact-assignment';

/**
 * 외주 담당 범위 나누기의 입력 (ADR-0035, fieldwork-multi-company 티켓 03).
 *
 * 조건 줄은 컨택원 교체 적용과 **같은 모양·같은 상한**이다 — 같은 조건 편집기에서 온다. 줄 0개는
 * 거부한다(전원이 빠지는 사고 방지 — 범위를 비우려면 「담당 범위 없애기」가 아니라 0명 조건을 건다).
 * 링크 id 는 최상위 `linkId` 로 받는다 — rpc 로그가 그 칸을 `targetLinkId` 로 싣는다(티켓 02).
 */
export const FieldworkShareListInput = z.object({ surveyId: z.uuid() });
export type FieldworkShareListInput = z.infer<typeof FieldworkShareListInput>;

export const FieldworkShareTargetInput = z.object({ surveyId: z.uuid(), linkId: z.uuid() });
export type FieldworkShareTargetInput = z.infer<typeof FieldworkShareTargetInput>;

export const FieldworkShareClausesInput = FieldworkShareTargetInput.extend({
  clauses: AssignmentClausesSchema,
});
export type FieldworkShareClausesInput = z.infer<typeof FieldworkShareClausesInput>;

export const FieldworkShareMatchesInput = FieldworkShareClausesInput.extend({
  page: z.number().int().min(1).max(100_000),
});
export type FieldworkShareMatchesInput = z.infer<typeof FieldworkShareMatchesInput>;

export const FieldworkShareFacetsInput = z.object({
  surveyId: z.uuid(),
  source: z.string().min(1).max(300),
});
export type FieldworkShareFacetsInput = z.infer<typeof FieldworkShareFacetsInput>;

export const FieldworkShareChangeSummarySchema = z.object({
  matched: z.number().int(),
  current: z.number().int(),
  incoming: z.number().int(),
  fromOthers: z.array(z.object({ linkId: z.uuid(), name: z.string(), count: z.number().int() })),
  leaving: z.number().int(),
});

export const FieldworkShareListOutput = z.object({
  links: z.array(
    z.object({
      linkId: z.uuid(),
      name: z.string(),
      divided: z.boolean(),
      count: z.number().int(),
      appliedAt: z.date().nullable(),
    }),
  ),
});

export const FieldworkShareClearOutput = z.object({
  /** 범위에서 풀린 인원 */
  released: z.number().int(),
});
