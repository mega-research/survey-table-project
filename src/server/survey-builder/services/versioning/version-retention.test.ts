/**
 * 버전 보존 규칙 (2026-07-31 spec §5.1 + ADR-0014 이관 출처 보호 + 2026-10-23 휴지통·이관 이력):
 *   keep = 지금 배포본·테스트 버전 OR 완전 삭제되지 않은 비테스트 응답 보유(휴지통 포함)
 *          OR 이관 출처로 참조됨 OR 이관 이력이 가리킴
 * 테스트 응답은 보존 근거로 치지 않는다.
 */
import { describe, expect, it } from 'vitest';

import { isVersionPrunable, type VersionRetentionInput } from './version-retention';

const none: VersionRetentionInput = {
  isPinnedVersion: false,
  nonTestResponseCount: 0,
  migratedFromReferenceCount: 0,
  migrationHistoryReferenceCount: 0,
  snapshotIsNull: false,
};

describe('isVersionPrunable', () => {
  it('붙잡을 것이 없으면 정리 대상이다', () => {
    expect(isVersionPrunable(none)).toBe(true);
  });

  it('지금 배포본·테스트 버전은 응답이 없어도 보존한다', () => {
    expect(isVersionPrunable({ ...none, isPinnedVersion: true })).toBe(false);
  });

  it('비테스트 응답이 있으면 보존한다 — 휴지통에 있는 응답도 센다(되살릴 수 있으므로)', () => {
    expect(isVersionPrunable({ ...none, nonTestResponseCount: 1 })).toBe(false);
  });

  it('이관 출처로 참조되는 버전은 응답이 재핀되어도 보존한다 (ADR-0014)', () => {
    expect(isVersionPrunable({ ...none, migratedFromReferenceCount: 3 })).toBe(false);
  });

  it('이관 이력이 옮기기 전·후로 가리키는 버전은 보존한다', () => {
    expect(isVersionPrunable({ ...none, migrationHistoryReferenceCount: 1 })).toBe(false);
  });

  it('이미 정리된 버전은 다시 정리 대상이 아니다', () => {
    expect(isVersionPrunable({ ...none, snapshotIsNull: true })).toBe(false);
  });
});
