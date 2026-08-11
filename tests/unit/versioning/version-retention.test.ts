/**
 * 버전 보존 규칙 (2026-07-31 spec §5.1):
 *   keep = 현재 발행본 OR 살아있는 비테스트 응답 보유
 * 테스트 응답·soft-delete 응답은 보존 근거로 치지 않는다.
 */
import { describe, expect, it } from 'vitest';

import { isVersionPrunable } from '@/lib/versioning/version-retention';

describe('isVersionPrunable', () => {
  it('현재 발행본은 응답이 없어도 보존한다', () => {
    expect(
      isVersionPrunable({
        isCurrentVersion: true,
        liveNonTestResponseCount: 0,
        snapshotIsNull: false,
      }),
    ).toBe(false);
  });

  it('살아있는 비테스트 응답이 있으면 보존한다', () => {
    expect(
      isVersionPrunable({
        isCurrentVersion: false,
        liveNonTestResponseCount: 1,
        snapshotIsNull: false,
      }),
    ).toBe(false);
  });

  it('현재 발행본이 아니고 살아있는 비테스트 응답이 없으면 정리 대상이다', () => {
    expect(
      isVersionPrunable({
        isCurrentVersion: false,
        liveNonTestResponseCount: 0,
        snapshotIsNull: false,
      }),
    ).toBe(true);
  });

  it('이미 정리된 버전은 다시 정리 대상이 아니다', () => {
    expect(
      isVersionPrunable({
        isCurrentVersion: false,
        liveNonTestResponseCount: 0,
        snapshotIsNull: true,
      }),
    ).toBe(false);
  });
});
