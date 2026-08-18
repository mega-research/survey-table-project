import { authed } from '@/server/orpc';

import {
  UpdateProfileColumnsInput,
  UpdateProfileColumnsResult,
} from '../../domain/profile-columns';
import * as svc from '../services/profile-columns.service';

/**
 * 응답 내역 컬럼 픽커 갱신.
 * 검증 실패도 throw 가 아니라 { ok:false, error } 로 그대로 통과 — 소비처가
 * result.ok / result.error 로 분기하므로 handler 에서 throw 하지 않는다.
 */
const updateColumns = authed
  .input(UpdateProfileColumnsInput)
  .output(UpdateProfileColumnsResult)
  .handler(({ input }) => svc.updateProfileColumns(input));

export const profileColumns = {
  updateColumns,
};
