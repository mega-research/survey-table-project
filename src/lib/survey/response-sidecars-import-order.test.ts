/**
 * 루트 사이드카 등록부가 모듈 진입 순서에 흔들리지 않는지 고정한다.
 *
 * 등록부(`response-sidecars`)가 `OPT_TEXTS_KEY` 를 소유하던 동안
 * `response-sidecars → change-confirmation → prior-answers → response-sidecars`
 * 3-사이클이 닫혀 있었다. change-confirmation 쪽으로 먼저 진입하면 등록부의
 * `SANITIZERS` 계산 키가 초기화 전 값을 읽어 `__changeConfirm__` 이 등록 목록에서
 * 조용히 빠졌다 — 그러면 변동 확인 값이 저장 경계에서 사라진다(AGENTS.md 주의사항 13
 * 이 `__optTexts__` 로 이미 두 번 겪었다고 못박은 사고 계열).
 *
 * 키를 잎 모듈(`lib/option-text-read`)로 내려 순환을 끊었고, 이 테스트는 그 순환이
 * 되살아나면 RED 로 알린다. **첫 import 가 change-confirmation 쪽이어야 의미가 있다.**
 */
import '@/lib/spss/change-confirm-variable';

import { describe, expect, it } from 'vitest';

import { CHANGE_CONFIRM_KEY } from '@/lib/survey/change-confirmation';
import {
  PERSISTED_ROOT_SIDECAR_KEYS,
  isPersistedRootSidecarKey,
} from '@/lib/survey/response-sidecars';

describe('루트 사이드카 등록부 — 모듈 진입 순서 무관', () => {
  it('change-confirmation 쪽으로 먼저 진입해도 변동 확인 키가 등록돼 있다', () => {
    expect(CHANGE_CONFIRM_KEY).toBe('__changeConfirm__');
    expect(PERSISTED_ROOT_SIDECAR_KEYS).toContain(CHANGE_CONFIRM_KEY);
    expect(isPersistedRootSidecarKey(CHANGE_CONFIRM_KEY)).toBe(true);
  });

  it('등록 키 목록에 undefined 가 섞여 있지 않다', () => {
    for (const key of PERSISTED_ROOT_SIDECAR_KEYS) {
      expect(key).toMatch(/^__/);
      expect(key).not.toBe('undefined');
    }
  });
});
