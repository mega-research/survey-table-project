import 'server-only';
import { cache } from 'react';

import { getContactResultCodes } from '@/lib/operations/contacts.server';

import {
  extractResultCodeStatuses,
  type ResultCodeStatuses,
} from '@/lib/operations/result-code-statuses';

/**
 * `surveys.contact_result_codes` 조회 → extractResultCodeStatuses 적용.
 *
 * 내부적으로 `getContactResultCodes` 위임 — 같은 RSC pass 안에서 두 함수가
 * 모두 호출돼도 cache dedupe 로 DB query 1회.
 */
export const getResultCodeStatuses = cache(
  async (surveyId: string): Promise<ResultCodeStatuses> => {
    const codes = await getContactResultCodes(surveyId);
    return extractResultCodeStatuses(codes);
  },
);
