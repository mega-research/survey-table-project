import * as z from 'zod';

import { INT32_MAX, MAX_STORED_ID_LIST } from '@/lib/operations/range-list';

export const CreateContactIdListInput = z.object({
  surveyId: z.string().uuid(),
  /** 시스템ID 또는 숫자 attrs 값. 중복·정렬은 서버가 정리한다. */
  ids: z.array(z.number().int().min(1).max(INT32_MAX)).min(1).max(MAX_STORED_ID_LIST),
});
export type CreateContactIdListInput = z.infer<typeof CreateContactIdListInput>;

export const CreateContactIdListOutput = z.object({
  /** contact_id_lists.id — URL 토큰 `list:<id>:<count>` 의 재료 */
  id: z.string().uuid(),
  /** 중복 제거 후 저장된 개수 */
  count: z.number().int().min(1),
});
export type CreateContactIdListOutput = z.infer<typeof CreateContactIdListOutput>;
