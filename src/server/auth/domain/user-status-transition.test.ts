/**
 * 계정 상태 전이 규칙 (역할 모델 v2 티켓 04).
 *
 * 이 파일이 지키는 것은 두 가지다.
 *   - 허용 전이표 밖의 조합은 전부 거부된다 — 표에 없는 조합이 조용히 통과하면
 *     퇴사자가 일반 재직 복귀로 살아나거나(ADR-0010 위반) 도달 불가 어휘가 되살아난다.
 *   - 마지막 active 슈퍼어드민 가드가 "이 전이로 active 슈퍼어드민이 0명이 되는가"만
 *     묻는다 — 이미 비활성인 슈퍼어드민의 퇴사까지 막으면 계정을 정리할 수 없게 된다.
 */
import { describe, expect, it } from 'vitest';

import type { UserStatus } from '@/shared/contracts/auth';
import { availableUserStatusActions, userStatusActionValues } from '@/shared/contracts/auth';

import { LastActiveSuperadminError, UserStatusTransitionError } from './users';
import { leavesActiveStatus, resolveUserStatusTransition } from './user-status-transition';

const ALL_STATUSES: UserStatus[] = ['pending', 'active', 'rejected', 'suspended', 'departed'];

/** 허용 전이 정본 — 티켓 04 수용 기준의 표를 그대로 옮긴 것. */
const ALLOWED: { from: UserStatus; action: (typeof userStatusActionValues)[number]; to: UserStatus }[] =
  [
    { from: 'active', action: 'suspend', to: 'suspended' },
    { from: 'suspended', action: 'resume', to: 'active' },
    { from: 'active', action: 'depart', to: 'departed' },
    { from: 'suspended', action: 'depart', to: 'departed' },
    { from: 'departed', action: 'rehire', to: 'active' },
  ];

describe('resolveUserStatusTransition — 허용 전이', () => {
  it.each(ALLOWED)('$from + $action → $to', ({ from, action, to }) => {
    expect(resolveUserStatusTransition(from, action, false)).toBe(to);
  });

  it('허용 조합은 정확히 5개뿐이다 (그 외 전 조합 거부)', () => {
    const rejected: string[] = [];
    for (const from of ALL_STATUSES) {
      for (const action of userStatusActionValues) {
        const allowed = ALLOWED.some((row) => row.from === from && row.action === action);
        if (allowed) continue;
        try {
          resolveUserStatusTransition(from, action, false);
          rejected.push(`${from}+${action} 이 통과했다`);
        } catch (err) {
          if (!(err instanceof UserStatusTransitionError)) {
            rejected.push(`${from}+${action} 이 다른 에러를 던졌다`);
          }
        }
      }
    }
    expect(rejected).toEqual([]);
  });

  it('퇴사자는 재직 복귀가 아니라 재입사로만 돌아온다 (ADR-0010)', () => {
    expect(() => resolveUserStatusTransition('departed', 'resume', false)).toThrow(
      UserStatusTransitionError,
    );
    expect(resolveUserStatusTransition('departed', 'rehire', false)).toBe('active');
  });
});

describe('resolveUserStatusTransition — 마지막 active 슈퍼어드민 가드', () => {
  it('마지막 active 슈퍼어드민은 정지·퇴사할 수 없다', () => {
    expect(() => resolveUserStatusTransition('active', 'suspend', true)).toThrow(
      LastActiveSuperadminError,
    );
    expect(() => resolveUserStatusTransition('active', 'depart', true)).toThrow(
      LastActiveSuperadminError,
    );
  });

  it('active 인원을 늘리는 전이는 가드와 무관하다', () => {
    expect(resolveUserStatusTransition('suspended', 'resume', true)).toBe('active');
    expect(resolveUserStatusTransition('departed', 'rehire', true)).toBe('active');
  });

  it('전이 자체가 불가하면 가드보다 전이 거부가 먼저다', () => {
    expect(() => resolveUserStatusTransition('departed', 'suspend', true)).toThrow(
      UserStatusTransitionError,
    );
  });
});

describe('leavesActiveStatus', () => {
  it('정지·퇴사만 대상을 active 밖으로 보낸다 — 이 액션에서만 카운트 쿼리를 돈다', () => {
    expect(leavesActiveStatus('suspend')).toBe(true);
    expect(leavesActiveStatus('depart')).toBe(true);
    expect(leavesActiveStatus('resume')).toBe(false);
    expect(leavesActiveStatus('rehire')).toBe(false);
  });
});

describe('availableUserStatusActions — 케밥이 여는 액션', () => {
  it.each([
    ['active', ['suspend', 'depart']],
    ['suspended', ['resume', 'depart']],
    ['departed', ['rehire']],
    ['pending', []],
    ['rejected', []],
  ] as const)('%s 행은 %j 를 연다', (status, expected) => {
    expect(availableUserStatusActions(status)).toEqual(expected);
  });

  it('여는 액션은 전부 실제로 전이 가능하다 (표와 화면이 갈리지 않는다)', () => {
    for (const status of ALL_STATUSES) {
      for (const action of availableUserStatusActions(status)) {
        expect(() => resolveUserStatusTransition(status, action, false)).not.toThrow();
      }
    }
  });
});
