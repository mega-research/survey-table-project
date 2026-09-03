import { describe, expect, it } from 'vitest';

import { getTableConfig } from 'drizzle-orm/pg-core';

import { contactPriorAnswers } from './contacts';

/**
 * 이월 응답의 파티션 계약 — 추적조사.
 *
 * 이월 응답은 조사 대상에 붙으므로 조사 대상의 파티션(`contact_targets.is_test`)을
 * 그대로 따른다. 여기에 축을 하나 더 얹으면 실/테스트 판정이 두 곳으로 갈려,
 * 한쪽만 필터를 태운 조회가 조용히 남의 파티션 값을 보게 된다.
 */
describe('contact_prior_answers 파티션 계약', () => {
  it('별도 파티션 축(is_test)을 갖지 않는다', () => {
    expect(Object.keys(contactPriorAnswers)).not.toContain('isTest');
  });

  it('조사 대상 하나당 한 행이다 — 재업로드가 통째 교체가 되는 근거다', () => {
    // 테이블 레벨 UNIQUE 로 걸려 있다. 이 제약이 없으면 onConflictDoUpdate 가
    // 걸릴 곳이 없어 재업로드가 행을 쌓는다.
    const config = getTableConfig(contactPriorAnswers);
    expect(
      config.uniqueConstraints.some((constraint) =>
        constraint.columns.some((column) => column.name === 'contact_target_id'),
      ),
    ).toBe(true);
  });
});
