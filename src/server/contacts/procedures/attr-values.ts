import { loadOperationsDataScope } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share';
import { scoped } from '@/server/orpc';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  CountNonNumericAttrValuesOutput,
  ListContactAttrValuesInput,
  ListContactAttrValuesOutput,
} from '../domain/contact-attr-values';
import * as svc from '../services/contact-attr-values';

/**
 * 헤더 필터 드롭다운 — attrs 컬럼 distinct 값 조회.
 * 컨택 목록은 게스트 grant 콘솔 표면이므로 scoped + 게스트 겸용 관문
 * (attempts/targets 와 동일 패턴). 스킴 화이트리스트 검증은 service 가 수행
 * (ForbiddenAttrColumnError → 403).
 */
const list = scoped
  .errors({
    FORBIDDEN_COLUMN: {
      status: 403,
      message: '컬럼 스킴에 없는 컬럼입니다.',
    },
  })
  .input(ListContactAttrValuesInput)
  .output(ListContactAttrValuesOutput)
  .handler(async ({ input, context, errors }) => {
    await assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, 'contacts.view');
    const scope = await loadOperationsDataScope(input.surveyId, context.actor);
    // 외주 링크는 자기 담당 범위 대상의 값만 — 값 목록으로 남의 대상이 새지 않게(티켓 03).
    const share = resolveFieldworkShare(context.actor, input.surveyId);
    try {
      return await svc.listContactAttrValues({ ...input, scope, share });
    } catch (error) {
      if (error instanceof svc.ForbiddenAttrColumnError) {
        throw errors.FORBIDDEN_COLUMN();
      }
      throw error;
    }
  });

/**
 * 홀짝 조건(`짝수`/`홀수`) 입력 상태줄 — 그 열에서 숫자가 아니라 걸리지 않는 인원.
 * 조사 대상 필터와 같은 표면이라 list 와 같은 권한·화이트리스트를 탄다.
 */
const nonNumericCount = scoped
  .errors({
    FORBIDDEN_COLUMN: {
      status: 403,
      message: '컬럼 스킴에 없는 컬럼입니다.',
    },
  })
  .input(ListContactAttrValuesInput)
  .output(CountNonNumericAttrValuesOutput)
  .handler(async ({ input, context, errors }) => {
    await assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, 'contacts.view');
    const scope = await loadOperationsDataScope(input.surveyId, context.actor);
    // 외주 링크는 자기 담당 범위 대상의 값만 — 값 목록으로 남의 대상이 새지 않게(티켓 03).
    const share = resolveFieldworkShare(context.actor, input.surveyId);
    try {
      return { count: await svc.countNonNumericAttrValues({ ...input, scope, share }) };
    } catch (error) {
      if (error instanceof svc.ForbiddenAttrColumnError) {
        throw errors.FORBIDDEN_COLUMN();
      }
      throw error;
    }
  });

export const attrValues = {
  list,
  nonNumericCount,
};
