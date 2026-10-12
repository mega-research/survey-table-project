import { describe, expect, it } from 'vitest';

import { resolveGuestSurveyLifecycle } from './guest-surveys';

const NOW = new Date('2026-10-12T00:00:00.000Z').getTime();

function row(over: Partial<Parameters<typeof resolveGuestSurveyLifecycle>[0]> = {}) {
  return {
    status: 'published' as const,
    currentVersionId: 'version-1',
    isPaused: false,
    endDate: null,
    ...over,
  };
}

/**
 * 클라이언트 화면 머리의 진행 상태 — 「미발행 · 진행중 · 일시중지 · 종료」.
 *
 * 설문 종료(ADR-0030)가 생기기 전에는 `status` 가 published 가 아니면 전부 「미발행」이었다.
 * 그 규칙을 그대로 두면 **종료한 설문이 클라이언트에게 「미발행」으로 보인다** — 조사가 끝났다는
 * 사실이 아직 시작도 안 했다는 말로 바뀐다.
 */
describe('resolveGuestSurveyLifecycle', () => {
  it('발행돼 돌고 있으면 진행중이다', () => {
    expect(resolveGuestSurveyLifecycle(row(), NOW)).toBe('running');
  });

  it('종료한 설문은 미발행이 아니라 종료다', () => {
    expect(resolveGuestSurveyLifecycle(row({ status: 'closed' }), NOW)).toBe('closed');
  });

  it('종료와 중단이 겹치면 종료다 — 끝난 조사의 중단 여부는 의미가 없다', () => {
    expect(resolveGuestSurveyLifecycle(row({ status: 'closed', isPaused: true }), NOW)).toBe(
      'closed',
    );
  });

  it('마감일이 지난 설문도 종료다 (종전 동작)', () => {
    expect(
      resolveGuestSurveyLifecycle(row({ endDate: new Date(NOW - 1000) }), NOW),
    ).toBe('closed');
  });

  it('중단만 걸려 있으면 일시중지다', () => {
    expect(resolveGuestSurveyLifecycle(row({ isPaused: true }), NOW)).toBe('paused');
  });

  it('발행된 적이 없으면 미발행이다 — 초안이든, 배포 버전이 없든', () => {
    expect(resolveGuestSurveyLifecycle(row({ status: 'draft', currentVersionId: null }), NOW)).toBe(
      'draft',
    );
    expect(resolveGuestSurveyLifecycle(row({ currentVersionId: null }), NOW)).toBe('draft');
    // 종료는 발행된 적 있는 설문에만 선다 — 버전이 없으면 열 것이 없으므로 미발행이 먼저다.
    expect(resolveGuestSurveyLifecycle(row({ status: 'closed', currentVersionId: null }), NOW)).toBe(
      'draft',
    );
  });
});
