import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';

import type { ReeditDenial } from '../../domain/acceptance';
import {
  AllowReeditResponseInput,
  HardResetResponseInput,
  ResponseManageOutput,
  RestoreResponseInput,
  SoftDeleteResponseInput,
} from '../../domain/response-manage';
import * as svc from '../services/response-manage.service';

/** SurveyOwnershipError('not_found') → NOT_FOUND. */
function mapServiceError(err: unknown): never {
  if (err instanceof svc.SurveyOwnershipError) {
    throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다' });
  }
  throw err;
}

// Record<ReeditDenial, string> 으로 좁혀 둔다. Record<string, string> 이면 사유가 늘어도
// 키 누락이 컴파일을 통과하고 런타임에 아래 폴백 문구가 조용히 나간다.
const REEDIT_UNAVAILABLE_MESSAGE: Record<ReeditDenial, string> = {
  status_not_published: '설문이 배포(published) 상태가 아니라 재응답을 허용할 수 없습니다.',
  survey_paused: '설문이 중단 상태라 재응답을 허용할 수 없습니다. 중단을 해제한 뒤 다시 시도하세요.',
  end_date_passed: '설문 마감일이 지나 재응답을 허용할 수 없습니다.',
  invite_required: '이 응답에 연결된 조사 대상이 없어 재응답 링크를 줄 수 없습니다.',
};

const softDelete = authed
  .input(SoftDeleteResponseInput)
  .output(ResponseManageOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.softDeleteResponse(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

const restore = authed
  .input(RestoreResponseInput)
  .output(ResponseManageOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.restoreResponse(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

const hardReset = authed
  .input(HardResetResponseInput)
  .output(ResponseManageOutput)
  .handler(async ({ input, context }) => {
    try {
      // 초기화 마커(수정/편집 현황)에 누가 실행했는지 스냅샷으로 남긴다.
      return await svc.hardResetResponse(input, {
        id: context.user.id,
        email: context.user.email ?? null,
      });
    } catch (err) {
      mapServiceError(err);
    }
  });

const allowReedit = authed
  .input(AllowReeditResponseInput)
  .output(ResponseManageOutput)
  .handler(async ({ input, context }) => {
    try {
      // 재응답 허용 마커(수정/편집 현황)에 누가 실행했는지 스냅샷으로 남긴다.
      return await svc.allowReeditResponse(input, {
        id: context.user.id,
        email: context.user.email ?? null,
      });
    } catch (err) {
      // 설문이 응답을 받을 수 없는 상태 — 사유별 안내 메시지로 매핑
      if (err instanceof svc.ReeditUnavailableError) {
        throw new ORPCError('BAD_REQUEST', {
          message: REEDIT_UNAVAILABLE_MESSAGE[err.reason] ?? '재응답을 허용할 수 없습니다.',
        });
      }
      mapServiceError(err);
    }
  });

export const manage = {
  softDelete,
  restore,
  hardReset,
  allowReedit,
};
