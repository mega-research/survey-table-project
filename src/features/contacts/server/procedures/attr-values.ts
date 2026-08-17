import { authed } from '@/server/orpc';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';

import {
  ListContactAttrValuesInput,
  ListContactAttrValuesOutput,
} from '../../domain/contact-attr-values';
import * as svc from '../services/contact-attr-values.service';

/**
 * 헤더 필터 드롭다운 — attrs 컬럼 distinct 값 조회(authed).
 * 스킴 화이트리스트 검증은 service 가 수행 (ForbiddenAttrColumnError → 403).
 */
const list = authed
  .errors({
    FORBIDDEN_COLUMN: {
      status: 403,
      message: '컬럼 스킴에 없는 컬럼입니다.',
    },
  })
  .input(ListContactAttrValuesInput)
  .output(ListContactAttrValuesOutput)
  .handler(async ({ input, errors }) => {
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
