import { assertSurveyAccess, scoped } from '@/server/orpc';
import { loadOperationsDataScope } from '@/server/data-scope.server';

import {
  ListContactAttrValuesInput,
  ListContactAttrValuesOutput,
} from '../domain/contact-attr-values';
import * as svc from '../services/contact-attr-values.service';

/**
 * 헤더 필터 드롭다운 — attrs 컬럼 distinct 값 조회.
 * 컨택 목록은 게스트 grant 콘솔 표면이므로 scoped + assertSurveyAccess
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
    assertSurveyAccess(context.user.id, input.surveyId);
    const scope = await loadOperationsDataScope(input.surveyId);
    try {
      return await svc.listContactAttrValues({ ...input, scope });
    } catch (error) {
      if (error instanceof svc.ForbiddenAttrColumnError) {
        throw errors.FORBIDDEN_COLUMN();
      }
      throw error;
    }
  });

export const attrValues = {
  list,
};
