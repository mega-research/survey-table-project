// 소유권 승계 도메인 (.pen FLOW 4-4·9-3, 티켓 19).
//
// client-safe — server-only·Node·DB 의존 없음. **제안 규칙(순수)** 과 서버 전용 에러 어휘만
// 산다 — 계약은 소비자(procedures·services)가 shared/contracts 에서 직접 받는다. 형제
// 도메인처럼 되내보내지 않는 이유는 이 파일의 소비자가 그 통로를 아무도 쓰지 않아서다.

/**
 * 후임 제안이 보는 후보 한 명.
 *
 * DB 모양이 아니라 **판정에 필요한 것만**이다 — 규칙을 순수 함수로 두려면 조회 결과가
 * 이 모양으로 좁혀져 들어와야 한다.
 */
export interface SuccessionCandidate {
  userId: string;
  /** 이 설문의 참여자인가. 아니면 소유 팀 팀장이다(둘 다인 경우 참여자가 먼저 선다). */
  isParticipant: boolean;
  /** 참여자로 초대된 시각 — 참여자가 아니면 null. 「초대순」의 기준이다. */
  invitedAt: Date | null;
  /** 소유 팀의 팀장인가. */
  isOwningTeamLeader: boolean;
}

/**
 * 후임 제안 — **순서가 곧 결정이다**(스펙 §4, 2026-08-25 Q11).
 *
 *  ① 참여자 중 **가장 먼저 초대된** 사람
 *  ② 소유 팀 팀장
 *  ③ 없으면 null → 승계 대기(succession_pending)
 *
 * 참여자를 팀장보다 앞세우는 이유는 그 설문을 실제로 함께 만든 사람이기 때문이다. 팀장은
 * 조직상 책임자일 뿐 그 설문의 맥락을 모를 수 있다.
 *
 * **제안일 뿐 실행이 아니다.** 처리자가 확인·변경한 뒤에만 이전된다 — 무확인 자동 이전은
 * 하지 않는다(ADR-0011 의 자동 승계 금지와 같은 취지). 이 함수가 null 을 돌려주는 것은
 * 「아무도 못 받는다」가 아니라 「제안할 사람이 없으니 사람이 정하라」는 뜻이다.
 *
 * 초대 시각이 같으면 userId 로 가른다 — 같은 트랜잭션에서 여러 명을 초대하면 시각이 같을 수
 * 있고, 그때 제안이 요청마다 흔들리면 화면이 새로고침마다 다른 후임을 보여준다.
 */
export function proposeSuccessor(
  candidates: readonly SuccessionCandidate[],
): SuccessionCandidate | null {
  const participants = candidates
    .filter((c) => c.isParticipant && c.invitedAt !== null)
    .sort((a, b) => {
      const diff = a.invitedAt!.getTime() - b.invitedAt!.getTime();
      return diff !== 0 ? diff : a.userId.localeCompare(b.userId);
    });
  if (participants[0]) return participants[0];

  const leaders = candidates
    .filter((c) => c.isOwningTeamLeader)
    .sort((a, b) => a.userId.localeCompare(b.userId));
  return leaders[0] ?? null;
}

/**
 * 새 소유자가 어느 팀에도 속해 있지 않다.
 *
 * `resolveSurveyCapabilities` 의 소유자 분기는 **소유 팀 소속일 때만** 전권을 준다(티켓 13
 * revocation 계약). 팀 없는 사람에게 넘기면 설문이 갈 팀이 없고, 그 소유자는 자기 설문을
 * 열지도 못한다.
 *
 * 아래 `AmbiguousOwnerTeamError` 와 **갈라 두는 이유는 조치가 다르기 때문**이다 — 이쪽은
 * 「그 사람을 팀에 배정하라」이고 저쪽은 「다른 사람을 고르라」다. 한 타입으로 묶으면 화면이
 * 문구를 파싱해 조치를 갈라야 한다.
 */
export class OwnerHasNoTeamError extends Error {
  constructor() {
    super('새 소유자가 활성 팀에 속해 있지 않습니다. 팀에 배정한 뒤 다시 시도하세요.');
    this.name = 'OwnerHasNoTeamError';
  }
}

/** 새 소유자가 여러 팀에 속해 설문이 갈 팀을 시스템이 고를 수 없다 — 다른 사람을 고르게 한다. */
export class AmbiguousOwnerTeamError extends Error {
  constructor() {
    super(
      '새 소유자가 여러 팀에 속해 있어 설문이 갈 팀을 정할 수 없습니다. 같은 팀 멤버에게 이전하세요.',
    );
    this.name = 'AmbiguousOwnerTeamError';
  }
}

/**
 * 목적지 팀이 해산됐다 — 잠근 채로 확인했을 때 archived 였다.
 *
 * 무잠금으로 읽으면 그 사이 커밋된 해산을 못 보고 archived 팀으로 소유권을 옮긴다.
 */
export class OwnerTeamNotActiveError extends Error {
  constructor() {
    super('해산된 팀으로는 소유권을 옮길 수 없습니다.');
    this.name = 'OwnerTeamNotActiveError';
  }
}

/** 후보가 아닌 사람에게 넘기려 한다 — 같은 팀 active 멤버도, 이 설문 참여자도 아니다. */
export class NotATransferCandidateError extends Error {
  constructor() {
    super('같은 팀의 활성 멤버 또는 이 설문의 참여자에게만 이전할 수 있습니다.');
    this.name = 'NotATransferCandidateError';
  }
}

/** 이전하려는 설문이 없다 — 관문의 조회와 이 트랜잭션 사이에 삭제가 커밋된 경우. */
export class OwnershipSurveyNotFoundError extends Error {
  constructor() {
    super('설문을 찾을 수 없습니다.');
    this.name = 'OwnershipSurveyNotFoundError';
  }
}

/**
 * 화면이 보고 있던 소유자와 지금 소유자가 다르다 — 그 사이 다른 요청이 먼저 넘겼다.
 *
 * `FOR UPDATE` 만으로는 이것을 못 막는다(직렬화될 뿐 둘 다 성공한다). 기대 소유자를 함께
 * 받아 잠긴 값과 대조하는 것이 「동시 요청 중 하나만 성공」을 실제로 만드는 유일한 장치다.
 */
export class OwnershipChangedError extends Error {
  constructor() {
    super('그 사이 소유자가 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.');
    this.name = 'OwnershipChangedError';
  }
}

/** 지금 소유자에게 다시 넘기려 한다 — 아무 일도 일어나지 않는 요청이다. */
export class SelfTransferError extends Error {
  constructor() {
    super('이미 이 설문의 소유자입니다.');
    this.name = 'SelfTransferError';
  }
}
