/**
 * 후임 제안 규칙 (역할 모델 v2 티켓 19).
 *
 * 티켓의 체크박스가 「제안 우선순위가 결정 그대로: 참여자 초대순 → 팀장 → 승계 대기
 * (순수 함수 테스트)」다. 규칙을 순수 함수로 떼어낸 이유가 이것 — DB 없이 순서를 고정한다.
 */
import { describe, expect, it } from 'vitest';

import { type SuccessionCandidate, proposeSuccessor } from './succession';

const T = (iso: string) => new Date(iso);

function participant(userId: string, invitedAt: string, over: Partial<SuccessionCandidate> = {}) {
  return {
    userId,
    isParticipant: true,
    invitedAt: T(invitedAt),
    isOwningTeamLeader: false,
    ...over,
  } satisfies SuccessionCandidate;
}

function leader(userId: string): SuccessionCandidate {
  return { userId, isParticipant: false, invitedAt: null, isOwningTeamLeader: true };
}

describe('proposeSuccessor', () => {
  it('참여자 중 가장 먼저 초대된 사람을 제안한다', () => {
    const proposed = proposeSuccessor([
      participant('u-late', '2026-08-20T00:00:00Z'),
      participant('u-first', '2026-08-01T00:00:00Z'),
      participant('u-mid', '2026-08-10T00:00:00Z'),
    ]);
    expect(proposed?.userId).toBe('u-first');
  });

  it('참여자가 있으면 팀장보다 먼저다 — 그 설문을 함께 만든 사람이 우선', () => {
    const proposed = proposeSuccessor([
      leader('u-leader'),
      participant('u-participant', '2026-08-20T00:00:00Z'),
    ]);
    expect(proposed?.userId).toBe('u-participant');
  });

  it('참여자가 없으면 소유 팀 팀장을 제안한다', () => {
    expect(proposeSuccessor([leader('u-leader')])?.userId).toBe('u-leader');
  });

  it('아무도 없으면 null — 승계 대기로 간다는 뜻이다', () => {
    expect(proposeSuccessor([])).toBeNull();
  });

  it('참여자이면서 팀장이면 참여자 자격이 먼저 선다', () => {
    const both = participant('u-both', '2026-08-05T00:00:00Z', { isOwningTeamLeader: true });
    const proposed = proposeSuccessor([leader('u-other-leader'), both]);
    expect(proposed?.userId).toBe('u-both');
  });

  /**
   * 같은 트랜잭션에서 여러 명을 초대하면 `created_at` 이 같을 수 있다. 그때 제안이 요청마다
   * 흔들리면 화면이 새로고침마다 다른 후임을 보여주고, 처리자는 자기가 무엇을 확인했는지
   * 알 수 없게 된다.
   */
  it('초대 시각이 같으면 userId 로 갈라 언제나 같은 답을 준다', () => {
    const sameTime = '2026-08-01T00:00:00Z';
    const forward = proposeSuccessor([participant('u-b', sameTime), participant('u-a', sameTime)]);
    const reversed = proposeSuccessor([participant('u-a', sameTime), participant('u-b', sameTime)]);
    expect(forward?.userId).toBe('u-a');
    expect(reversed?.userId).toBe('u-a');
  });

  it('팀장이 여럿이어도 같은 답을 준다', () => {
    expect(proposeSuccessor([leader('u-z'), leader('u-a')])?.userId).toBe('u-a');
    expect(proposeSuccessor([leader('u-a'), leader('u-z')])?.userId).toBe('u-a');
  });

  /** 초대 시각이 없는 참여 행은 순서를 정할 수 없어 제안 대상이 아니다(방어적). */
  it('초대 시각이 없는 참여자는 건너뛰고 팀장으로 내려간다', () => {
    const broken: SuccessionCandidate = {
      userId: 'u-broken',
      isParticipant: true,
      invitedAt: null,
      isOwningTeamLeader: false,
    };
    expect(proposeSuccessor([broken, leader('u-leader')])?.userId).toBe('u-leader');
  });
});
