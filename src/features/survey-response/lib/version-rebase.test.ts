import { describe, expect, it } from 'vitest';

import { resolveRebasedVersionId } from '@/features/survey-response/lib/version-rebase';

// 무중단 갈아타기(티켓 04) — 클라이언트 재핀 감지 조건의 순수 로직.
// create 결과의 versionId 가 존재하고 클라이언트가 알던 versionId 와 다르면
// 재핀이 일어난 것으로 판정해 새 versionId 를 돌려준다.
describe('resolveRebasedVersionId', () => {
  it('결과 versionId 가 알던 값과 다르면 새 versionId 를 반환한다 (재핀 감지)', () => {
    expect(resolveRebasedVersionId('v-new', 'v-old')).toBe('v-new');
  });

  it('결과 versionId 가 알던 값과 같으면 null (재핀 아님)', () => {
    expect(resolveRebasedVersionId('v-1', 'v-1')).toBeNull();
  });

  it('결과에 versionId 가 없으면 null (구 서버/레거시 결과 호환)', () => {
    expect(resolveRebasedVersionId(undefined, 'v-1')).toBeNull();
    expect(resolveRebasedVersionId(null, 'v-1')).toBeNull();
  });

  it('클라이언트가 versionId 를 모르던 상태(null)에서 결과에 versionId 가 있으면 그 값을 반환한다', () => {
    // 컨택 재사용으로 버전이 박힌 기존 행을 물려받은 경우 — 최신 스냅샷 재취득은 무해하다.
    expect(resolveRebasedVersionId('v-1', null)).toBe('v-1');
  });
});
