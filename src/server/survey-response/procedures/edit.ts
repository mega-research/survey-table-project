import { ORPCError } from '@orpc/server';

import { isExternalAccount } from '@/shared/contracts/auth';
import { scoped } from '@/server/orpc';
import {
  assertScopedSurveyCapabilityRpc,
  toRpcSurveyAccessError,
} from '@/server/rpc-survey-access';
import { SurveyAccessError } from '@/server/survey-access';

import { SaveAdminEditInput, SaveAdminEditOutput } from '../domain/response-edit';
import * as svc from '../services/response-edit';
import { SurveyNotAcceptingResponsesError } from '../services/response-gate';

/** ResponseEditError 사유별 사용자 표시 — 문구는 그대로 유지한다. */
const EDIT_ERROR_RESPONSES: Record<
  svc.ResponseEditErrorReason,
  { code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT'; message: string }
> = {
  response_not_found: { code: 'NOT_FOUND', message: '응답을 찾을 수 없습니다' },
  response_deleted: { code: 'BAD_REQUEST', message: '삭제된 응답은 수정할 수 없습니다' },
  version_conflict: {
    code: 'CONFLICT',
    message: '수정 중 새 버전이 배포되었습니다. 새로고침 후 다시 수정해 주세요.',
  },
  status_conflict: {
    code: 'CONFLICT',
    message: '수정 중 응답 상태가 바뀌었습니다. 새로고침 후 다시 수정해 주세요.',
  },
};

/**
 * service throw 를 사용자 친화 ORPCError 로 변환.
 * - SurveyAccessError('not_found')(서비스 안 존재 확인) → NOT_FOUND.
 * - ResponseEditError → 사유별 매핑(위 표).
 * - answer_value_too_large(크기 가드) → BAD_REQUEST.
 */
function mapServiceError(err: unknown): never {
  if (err instanceof SurveyAccessError) {
    throw toRpcSurveyAccessError(err);
  }
  // 응답자 경로와 공유하는 크기 가드. 사유 문자열은 외부 계약이라 그대로 두고 코드만 접는다.
  if (err instanceof SurveyNotAcceptingResponsesError && err.reason === 'answer_value_too_large') {
    throw new ORPCError('BAD_REQUEST', {
      message: '응답값이 너무 큽니다. 해당 문항의 입력을 줄여 주세요.',
    });
  }
  if (err instanceof svc.ResponseEditError) {
    const mapped = EDIT_ERROR_RESPONSES[err.reason];
    throw new ORPCError(mapped.code, { message: mapped.message });
  }
  throw err;
}

const saveAdminEdit = scoped
  .input(SaveAdminEditInput)
  .output(SaveAdminEditOutput)
  .handler(async ({ input, context }) => {
    // 응답 수정은 스펙 §8 에서 응답 상세 열람과 한 행 — responses.view 로 지킨다.
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'responses.view');
    try {
      return await svc.saveAdminEdit(
        input,
        {
          id: context.user?.id ?? null,
          email: context.user?.email ?? null,
        },
        // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
        isExternalAccount(context.user.userType),
      );
    } catch (err) {
      mapServiceError(err);
    }
  });

export const edit = {
  saveAdminEdit,
};
