/**
 * 공유 설정 링크 카드의 「담당 범위 나누기」 주소 — 두 feature 가 같은 주소를 가리키는가 (fieldwork-multi-company 티켓 03).
 *
 * survey-builder(공유 설정)는 operations(주소 조립)를 import 하지 못한다(ESLint 경계 — 서로 독립). 그래서 카드가
 * 꼬리를 손으로 적고, 여기서 운영 콘솔의 정본과 맞춘다. 양쪽 다 막히는 교차 feature 계약이라 tests/repo 가 집이다.
 */
import { describe, expect, it } from 'vitest';

import { internalOperationsPaths } from '@/features/operations/operations-paths';
import { fieldworkShareEditHref } from '@/features/survey-builder/sharing/access-link-panel';

describe('담당 범위 나누기 주소', () => {
  it('링크 카드의 바로가기가 운영 콘솔의 담당 범위 수정 주소와 같다', () => {
    expect(fieldworkShareEditHref('sv-1', 'link-1')).toBe(
      internalOperationsPaths('sv-1').contactsShare('link-1'),
    );
  });
});
