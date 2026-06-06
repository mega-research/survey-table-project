import { pub } from '@/server/orpc';

import { CheckDuplicateOnEntryInput, CheckResultSchema } from '../../domain/duplicate';
import * as svc from '../services/duplicate.service';

/**
 * 진입 시 중복 감지(pub). 익명 응답자가 페이지 진입 직후 호출.
 * Track A(inviteToken) / Track B(clientSignals) 분기. blocked/통과 union 반환.
 */
const checkOnEntry = pub
  .input(CheckDuplicateOnEntryInput)
  .output(CheckResultSchema)
  .handler(({ input }) => svc.checkDuplicateOnEntry(input));

export const duplicate = {
  checkOnEntry,
};
