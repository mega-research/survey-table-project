import { authed } from '@/server/orpc';

import {
  UpdateProgressColumnsInput,
  UpdateProgressColumnsResult,
} from '../../domain/progress';
import * as svc from '../services/progress.service';

/**
 * 진척률 표 컬럼 갱신.
 * 검증 실패도 throw 가 아니라 { ok:false, error } 로 그대로 통과 — 소비처가
 * result.ok / result.error 로 분기하므로 handler 에서 throw 하지 않는다.
 */
const updateColumns = authed
  .input(UpdateProgressColumnsInput)
  .output(UpdateProgressColumnsResult)
  .handler(({ input }) => svc.updateProgressColumns(input));

export const progress = {
  updateColumns,
};
