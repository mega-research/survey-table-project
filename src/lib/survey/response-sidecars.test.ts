import { describe, expect, it } from 'vitest';

import {
  OPT_TEXTS_KEY,
  PERSISTED_ROOT_SIDECAR_KEYS,
  isPersistedRootSidecarKey,
  sanitizeRootSidecar,
  splitRootSidecars,
} from '@/lib/survey/response-sidecars';
import { CHANGE_CONFIRM_KEY } from '@/lib/survey/change-confirmation';
import { DYNAMIC_ROW_SELECTIONS_KEY } from '@/utils/dynamic-row-selection-sidecar';

describe('splitRootSidecars', () => {
  it('문항 답과 등록된 사이드카를 가른다', () => {
    const { answerEntries, sidecarEntries, unknownSidecarKeys } = splitRootSidecars([
      ['q-1', 'a'],
      [OPT_TEXTS_KEY, { 'q-1': { o1: '기타' } }],
      [CHANGE_CONFIRM_KEY, { 'q-1': 'same' }],
    ]);
    expect(answerEntries).toEqual([['q-1', 'a']]);
    expect(sidecarEntries.map(([k]) => k)).toEqual([OPT_TEXTS_KEY, CHANGE_CONFIRM_KEY]);
    expect(unknownSidecarKeys).toEqual([]);
  });

  /**
   * 예전에는 미등록 `__` 키가 답변 쪽에 남아 소속 검증에서 요청을 통째로 거부했다.
   * 부분 저장이 없으므로 키 하나가 그 응답자의 초안 저장을 영영 막는다.
   */
  it('등록되지 않은 예약 키는 답변으로 넘기지 않는다 — 요청 전체가 거부되면 안 된다', () => {
    const { answerEntries, sidecarEntries, unknownSidecarKeys } = splitRootSidecars([
      ['q-1', 'a'],
      ['__notRegistered__', { x: 1 }],
    ]);
    expect(answerEntries).toEqual([['q-1', 'a']]);
    expect(sidecarEntries).toEqual([]);
    expect(unknownSidecarKeys).toEqual(['__notRegistered__']);
  });

  it('밑줄 두 개로 시작하지 않는 키는 언제나 답변이다 — 진짜 문항을 삼키지 않는다', () => {
    const { answerEntries, unknownSidecarKeys } = splitRootSidecars([
      ['_single', 'a'],
      ['q_ab__cd', 'b'],
    ]);
    expect(answerEntries.map(([k]) => k)).toEqual(['_single', 'q_ab__cd']);
    expect(unknownSidecarKeys).toEqual([]);
  });
});

describe('동적 행 선택 사이드카 등록', () => {
  it('등록부에 올라 있다 — 미등록이면 동적 행 문항의 초안 저장이 통째로 거부된다', () => {
    expect(isPersistedRootSidecarKey(DYNAMIC_ROW_SELECTIONS_KEY)).toBe(true);
    expect(PERSISTED_ROOT_SIDECAR_KEYS).toContain(DYNAMIC_ROW_SELECTIONS_KEY);
  });

  it('형태를 정제하고 실존 문항만 남긴다', () => {
    const raw = { 'q-1': ['r1', 'r2'], 'q-gone': ['r3'], 'q-bad': 'not-an-array' };
    expect(sanitizeRootSidecar(DYNAMIC_ROW_SELECTIONS_KEY, raw, (id) => id === 'q-1')).toEqual({
      'q-1': ['r1', 'r2'],
    });
  });

  it('형태가 깨진 값은 빈 묶음으로 수렴한다', () => {
    expect(sanitizeRootSidecar(DYNAMIC_ROW_SELECTIONS_KEY, 'nope')).toEqual({});
    expect(sanitizeRootSidecar(DYNAMIC_ROW_SELECTIONS_KEY, null)).toEqual({});
  });
});

describe('sanitizeRootSidecar', () => {
  it('등록되지 않은 키는 null', () => {
    expect(sanitizeRootSidecar('__notRegistered__', { x: 1 })).toBeNull();
  });
});
