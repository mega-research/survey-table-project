/**
 * 스펙 §8 capability 매트릭스 — 표 그 자체를 테스트로 옮긴다 (역할 모델 v2 티켓 23, C 검증 게이트).
 *
 * `src/server/survey-access.test.ts` 와 겹치는 것이 의도다. **둘은 방향이 다르다** —
 * 저쪽은 분기(왜 그렇게 되는가)를 열 단위로 서술하고, 이쪽은 스펙의 **표**를 행 단위로
 * 옮긴다. 리뷰가 「스펙 §8 과 1:1 인가」를 물을 때 읽을 곳은 이 파일이고, 둘이 어긋나면
 * 표가 이긴다.
 *
 * 표를 옮기는 것만으로는 부족해 **완전성 가드 두 축**을 함께 둔다. 셀 단언만 있으면
 * ① 어휘에 capability 가 늘었는데 표에 행을 안 만든 경우와 ② 판정이 표에 없는 것을 더
 * 주는 경우가 둘 다 초록이다 — 표는 자기가 무엇을 안 적었는지 모른다.
 *  - 축 A: 모든 `surveyCapabilityValues` 가 정확히 한 행에 등장한다.
 *  - 축 B: 각 열에서 판정이 돌려주는 집합이 그 열의 O 칸 집합과 **정확히 같다**.
 *
 * 프리셋 상수(`ALL_CAPABILITIES` 등)를 다시 읽어 비교하지 않는 것도 계약이다. 구현이
 * 스스로를 채점하면 매트릭스가 바뀌어도 GREEN 이 유지된다 — 여기 적힌 O·- 는 전부 손으로
 * 옮긴 값이어야 한다.
 *
 * 실사 두 열은 티켓 25 가 채웠다. **실사 팀장 열은 초대가 아니라 파생 시야**라, 자기 업체
 * 소속원이 초대된 설문을 초대 없이 본다 — 그래서 이 열의 입력은 참여 행이 아니라
 * `fieldworkOrgInvited` 다(아래 COLUMNS 참조).
 */
import { describe, expect, it } from 'vitest';

import {
  resolveSurveyCapabilities,
  type SurveyAccessRelation,
  type SurveyAccessSubject,
  type SurveyAccessTarget,
  type SurveyParticipation,
} from '@/server/survey-access';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';

const TEAM_ID = 'team-owning';
const OTHER_TEAM_ID = 'team-other';
const OWNER_ID = 'user-owner';
const ORG_ID = 'org-green';

// ─────────────────────────────────────────────────────────────────────────────
// 열 — 스펙 §8 표의 세로축
// ─────────────────────────────────────────────────────────────────────────────

interface Column {
  subject: SurveyAccessSubject;
  participation: SurveyParticipation | null;
  /** 참여 행 밖의 관계 — 실사 팀장의 파생 시야가 이 축으로 선다. */
  relation?: SurveyAccessRelation;
}

/** 실사 주체 — 팀은 없고 업체·역할이 있다. */
function fieldwork(role: 'leader' | 'worker'): SurveyAccessSubject {
  return internal({
    userType: 'fieldwork',
    // 비내부 계정에 슈퍼어드민 플래그가 실려 와도 열리면 안 된다.
    isSuperadmin: true,
    activeTeamIds: [],
    leaderTeamIds: [],
    fieldworkOrgId: ORG_ID,
    fieldworkRole: role,
  });
}

function internal(over: Partial<SurveyAccessSubject> = {}): SurveyAccessSubject {
  return {
    userId: 'user-actor',
    isSuperadmin: false,
    userType: 'internal',
    activeTeamIds: [TEAM_ID],
    leaderTeamIds: [],
    fieldworkOrgId: null,
    fieldworkRole: null,
    ...over,
  };
}

/**
 * 표의 여섯 열. 이름은 스펙의 헤더를 그대로 쓴다.
 *
 * **각 열이 그 주체의 최소 조건만 갖게 세운다** — 예컨대 소유자 열에 팀장 권한을 함께
 * 주면 두 열이 같은 답을 내도 어느 분기가 답을 냈는지 알 수 없다.
 */
const COLUMNS = {
  슈퍼어드민: {
    // 팀이 없어도 선다 — 슈퍼어드민은 팀 축 밖이다.
    subject: internal({ isSuperadmin: true, activeTeamIds: [], leaderTeamIds: [] }),
    participation: null,
  },
  '팀장(소유 팀)': {
    subject: internal({ activeTeamIds: [TEAM_ID], leaderTeamIds: [TEAM_ID] }),
    participation: null,
  },
  소유자: {
    // 소유 팀 소속일 때만 소유자다(티켓 13 revocation) — 그 조건이 열의 정의에 포함된다.
    subject: internal({ userId: OWNER_ID, activeTeamIds: [TEAM_ID] }),
    participation: null,
  },
  참여자: {
    // 타 팀 사람이라는 것이 참여자 열의 요점이다 — 팀 축으로는 아무것도 열리지 않는다.
    subject: internal({ activeTeamIds: [OTHER_TEAM_ID] }),
    participation: { kind: 'member' },
  },
  '팀원(팀 공개만)': {
    subject: internal({ activeTeamIds: [TEAM_ID] }),
    participation: null,
  },
  '게스트(부여 설문)': {
    subject: internal({
      userType: 'guest',
      // 게스트에게는 팀이 없다(스펙 §1). isSuperadmin 은 실려 와도 무시된다.
      isSuperadmin: true,
      activeTeamIds: [],
      leaderTeamIds: [],
    }),
    participation: { kind: 'guest' },
  },
  '실사원(초대 설문)': {
    subject: fieldwork('worker'),
    participation: { kind: 'fieldwork' },
  },
  '실사 팀장(자기 업체)': {
    // **초대되지 않았다** — 소속원이 초대된 설문을 파생 시야로 본다(ADR-0019).
    // 본인이 초대되면 실사원 열과 같아지고, 그 차이는 아래 별도 블록이 잰다.
    subject: fieldwork('leader'),
    participation: null,
    relation: { fieldworkOrgInvited: true },
  },
} satisfies Record<string, Column>;

type ColumnName = keyof typeof COLUMNS;

const COLUMN_NAMES = Object.keys(COLUMNS) as ColumnName[];

// ─────────────────────────────────────────────────────────────────────────────
// 행 — 스펙 §8 표의 가로축
// ─────────────────────────────────────────────────────────────────────────────

type Cells = Record<ColumnName, boolean>;

interface Row {
  /** 스펙 표의 행 이름. 어휘 값과 다른 행은 그 이름을 그대로 옮긴다. */
  label: string;
  /** 이 행이 담당하는 capability 어휘. 「mail.view / mail.send」처럼 한 행이 둘일 수 있다. */
  capabilities: readonly SurveyCapability[];
  cells: Cells;
}

const O = true;
const X = false;

/**
 * `[슈퍼어드민, 팀장, 소유자, 참여자, 팀원, 게스트, 실사원, 실사 팀장]` —
 * 표의 칸 순서 그대로 읽는다.
 */
function cells(
  ...values: [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean]
): Cells {
  return Object.fromEntries(COLUMN_NAMES.map((name, i) => [name, values[i]])) as Cells;
}

/**
 * 스펙 §8 표 (2026-08-25 판) — 팀 공개(`visibility='team'`) · 배치 완료 설문 기준.
 *
 * 게스트 칸의 「프리뷰+허용 탭」·「허용 탭」은 **열림**이다. 탭은 capability 가 아니라
 * 별도 축이라(`guest_tabs`, 티켓 21) 이 표에는 나타나지 않는다 — 탭을 전부 켜도 이 열은
 * 늘지 않고, 전부 꺼도 두 칸은 열린 채다. 그 축은 survey-access.test.ts 가 따로 본다.
 */
const SPEC_ROWS: readonly Row[] = [
  //                                                    슈퍼  팀장  소유  참여  팀원  게스트
  { label: 'survey.view', capabilities: ['survey.view'],
    cells: cells(O, O, O, O, O, O, O, O) },
  { label: 'survey.edit', capabilities: ['survey.edit'],
    cells: cells(O, O, O, O, O, X, X, X) },
  { label: 'survey.publish', capabilities: ['survey.publish'],
    cells: cells(O, O, O, X, X, X, X, X) },
  { label: 'survey.delete (soft)', capabilities: ['survey.delete'],
    cells: cells(O, O, O, O, X, X, X, X) },
  { label: '초대 추가(참여자·게스트·실사)', capabilities: ['survey.invite'],
    cells: cells(O, O, O, O, O, X, X, X) },
  { label: '제외·공개 범위·부여 해제', capabilities: ['survey.manageAccess'],
    cells: cells(O, O, O, X, X, X, X, X) },
  { label: 'survey.transferOwnership', capabilities: ['survey.transferOwnership'],
    cells: cells(O, O, O, X, X, X, X, X) },
  { label: 'operations.view', capabilities: ['operations.view'],
    cells: cells(O, O, O, O, O, O, O, O) },
  { label: 'responses.view (상세·수정)', capabilities: ['responses.view'],
    cells: cells(O, O, O, O, X, X, X, X) },
  { label: 'contacts.view 원본', capabilities: ['contacts.view'],
    cells: cells(O, O, O, O, X, X, O, O) },
  { label: 'contacts.manage (업로드·수정)', capabilities: ['contacts.manage'],
    cells: cells(O, O, O, O, X, X, X, X) },
  { label: '결과코드·메모 쓰기', capabilities: ['contacts.writeAttempts'],
    cells: cells(O, O, O, O, X, X, O, X) },
  { label: 'mail.view / mail.send', capabilities: ['mail.view', 'mail.send'],
    cells: cells(O, O, O, O, X, X, X, X) },
  { label: 'export.download', capabilities: ['export.download'],
    cells: cells(O, O, O, O, X, X, X, X) },
  { label: 'analytics.view', capabilities: ['analytics.view'],
    cells: cells(O, O, O, O, O, X, X, X) },
  { label: 'surveyGroup.manage', capabilities: ['surveyGroup.manage'],
    cells: cells(O, O, O, X, O, X, X, X) },
];

// ─────────────────────────────────────────────────────────────────────────────
// 대상 설문 — 표의 전제이자 변형
// ─────────────────────────────────────────────────────────────────────────────

function survey(over: Partial<SurveyAccessTarget> = {}): SurveyAccessTarget {
  return {
    teamId: TEAM_ID,
    visibility: 'team',
    ownerUserId: OWNER_ID,
    assignmentStatus: 'assigned',
    ...over,
  };
}

function resolveFor(name: ColumnName, target: SurveyAccessTarget): ReadonlySet<SurveyCapability> {
  const column: Column = COLUMNS[name];
  return resolveSurveyCapabilities(column.subject, target, column.participation, column.relation);
}

/** 표에서 그 열이 O 인 capability 전부. */
function tableColumn(name: ColumnName): SurveyCapability[] {
  return SPEC_ROWS.filter((row) => row.cells[name])
    .flatMap((row) => [...row.capabilities])
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 완전성 — 표가 무엇을 안 적었는지 표는 모른다
// ─────────────────────────────────────────────────────────────────────────────

describe('표가 어휘 전체를 덮는다', () => {
  it('모든 capability 가 정확히 한 행에 있다', () => {
    const listed = SPEC_ROWS.flatMap((row) => [...row.capabilities]);
    // 중복이 있으면 한 행만 고쳐도 다른 행이 옛 값을 주장한다.
    expect(new Set(listed).size, '한 capability 가 두 행에 적혔다').toBe(listed.length);
    expect([...listed].sort()).toEqual([...surveyCapabilityValues].sort());
  });

  it('열은 스펙 헤더 여덟 개다', () => {
    expect(COLUMN_NAMES).toEqual([
      '슈퍼어드민',
      '팀장(소유 팀)',
      '소유자',
      '참여자',
      '팀원(팀 공개만)',
      '게스트(부여 설문)',
      '실사원(초대 설문)',
      '실사 팀장(자기 업체)',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 팀 공개 설문 — 표 본체
// ─────────────────────────────────────────────────────────────────────────────

describe('스펙 §8 표 — 팀 공개 설문', () => {
  const target = survey();

  it.each(SPEC_ROWS.flatMap((row) => COLUMN_NAMES.map((name) => [row.label, name, row] as const)))(
    '%s × %s',
    (_label, name, row) => {
      const resolved = resolveFor(name, target);
      for (const capability of row.capabilities) {
        expect(resolved.has(capability)).toBe(row.cells[name]);
      }
    },
  );

  it.each(COLUMN_NAMES)('%s 열은 표에 적힌 것 **만** 갖는다', (name) => {
    // 축 B — 셀 단언은 표에 적힌 것만 보므로, 판정이 표 밖의 무언가를 더 줘도 초록이다.
    expect([...resolveFor(name, target)].sort()).toEqual(tableColumn(name));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ invite_only — 열 하나만 무너진다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * v2 에서 invite_only 의 뜻은 「소유 팀 **팀원에게만** 숨김」이다(스펙 §3).
 *
 * 팀장까지 막으면 팀장이 자기 팀 설문을 관리할 수 없어 승계·해산이 잠기고, 참여자·게스트는
 * 애초에 팀 축 밖이라 공개 범위가 판정에 관여하지 않는다. 그래서 이 변형에서 바뀌는 열은
 * **정확히 하나**여야 한다 — 그것이 이 블록의 단언이다.
 */
describe('스펙 §8 표 — invite_only 변형', () => {
  const target = survey({ visibility: 'invite_only' });

  it('팀원 열이 통째로 비워진다', () => {
    expect([...resolveFor('팀원(팀 공개만)', target)]).toEqual([]);
  });

  it.each(COLUMN_NAMES.filter((name) => name !== '팀원(팀 공개만)'))(
    '%s 열은 팀 공개일 때와 한 칸도 다르지 않다',
    (name) => {
      expect([...resolveFor(name, target)].sort()).toEqual(tableColumn(name));
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 표 전체가 무너지는 두 조건 — 열이 아니라 설문·주체가 원인이다
// ─────────────────────────────────────────────────────────────────────────────

describe('스펙 §8 표 — 전 열 차단', () => {
  /**
   * 배치 대기는 판정 사슬의 **맨 앞**이다(ADR-0006) — 팀이 정해지기 전에는 소유자도
   * 부여받은 게스트도 열 수 없다. 슈퍼어드민만 예외인 것은 그 상태를 해소하는 사람이라서다.
   */
  it.each(COLUMN_NAMES.filter((name) => name !== '슈퍼어드민'))(
    '배치 대기 설문에서 %s 열은 비어 있다',
    (name) => {
      const pending = survey({ teamId: null, assignmentStatus: 'assignment_pending' });
      expect([...resolveFor(name, pending)]).toEqual([]);
    },
  );

  it('배치 대기 설문도 슈퍼어드민에게는 전권이다 — 해소할 사람이 못 보면 잠긴다', () => {
    const pending = survey({ teamId: null, assignmentStatus: 'assignment_pending' });
    expect([...resolveFor('슈퍼어드민', pending)].sort()).toEqual(tableColumn('슈퍼어드민'));
  });

  /**
   * 팀 미배치 — 스펙 §8 표에는 열이 없지만 티켓의 매트릭스 요구에 들어 있다(CONTEXT.md
   * 「팀 미배치 사용자」). **초대 설문을 포함해** 전부 차단이라는 것이 요점이다: 참여 행이
   * 팀 경계를 넘는 유일한 통로여도 그 앞의 미배치 가드를 넘지는 못한다.
   */
  describe('팀 미배치 내부 사용자', () => {
    const unassigned = internal({ activeTeamIds: [], leaderTeamIds: [] });

    it.each([
      ['팀 공개 설문', survey(), null],
      ['invite_only 설문', survey({ visibility: 'invite_only' }), null],
      ['참여자로 초대된 설문', survey(), { kind: 'member' } as SurveyParticipation],
    ] as const)('%s 에서 아무것도 열리지 않는다', (_label, target, participation) => {
      expect([...resolveSurveyCapabilities(unassigned, target, participation)]).toEqual([]);
    });

    it('소유자여도 마찬가지다 — 소유 팀에서 빠지면 전권이 끊긴다', () => {
      const removedOwner = internal({ userId: OWNER_ID, activeTeamIds: [], leaderTeamIds: [] });
      expect([...resolveSurveyCapabilities(removedOwner, survey())]).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 실사 열 — 오늘의 사실을 적어 둔다
// ─────────────────────────────────────────────────────────────────────────────

describe('실사 두 열의 차이 — 초대와 파생 시야 (티켓 25)', () => {
  const target = survey();

  /**
   * 팀장의 파생 시야는 **열람 한정**이다(ADR-0019, .pen 10-1 안내문).
   *
   * 초대된 실사원과 갈리는 칸이 정확히 하나여야 한다 — 결과코드·메모 쓰기. 그 하나가
   * 「본인이 초대돼야 기록할 수 있다」는 규칙의 전부이고, 여기서 두 칸 이상 갈리기 시작하면
   * 파생 시야가 별개 역할이 된 것이다.
   */
  it('초대 실사원과 팀장 시야는 결과코드 쓰기 한 칸만 다르다', () => {
    const worker = new Set(resolveFor('실사원(초대 설문)', target));
    const leader = new Set(resolveFor('실사 팀장(자기 업체)', target));
    const onlyWorker = [...worker].filter((c) => !leader.has(c));
    const onlyLeader = [...leader].filter((c) => !worker.has(c));
    expect(onlyWorker).toEqual(['contacts.writeAttempts']);
    expect(onlyLeader).toEqual([]);
  });

  it('본인이 초대된 팀장은 실사원 열을 그대로 갖는다 — 파생 시야가 권한을 깎지 않는다', () => {
    const invitedLeader = resolveSurveyCapabilities(
      COLUMNS['실사 팀장(자기 업체)'].subject,
      target,
      { kind: 'fieldwork' },
      { fieldworkOrgInvited: true },
    );
    expect([...invitedLeader].sort()).toEqual(tableColumn('실사원(초대 설문)'));
  });

  it('실사원에게는 파생 시야가 없다 — 소속원이 초대돼도 열리지 않는다', () => {
    const worker = resolveSurveyCapabilities(
      COLUMNS['실사원(초대 설문)'].subject,
      target,
      null,
      { fieldworkOrgInvited: true },
    );
    expect([...worker]).toEqual([]);
  });

  it('타 업체는 어떤 경우에도 열리지 않는다 — 파생 시야의 경계가 업체다', () => {
    // 로더가 업체로 좁혀 `fieldworkOrgInvited: false` 를 주는 것이 그 경계이고,
    // 코어는 그 값을 그대로 믿는다. 조인 자체는 realdb 스위트가 잰다.
    const leader = resolveSurveyCapabilities(
      COLUMNS['실사 팀장(자기 업체)'].subject,
      target,
      null,
      { fieldworkOrgInvited: false },
    );
    expect([...leader]).toEqual([]);
  });

  it('소속 업체가 없는 실사 계정은 아무것도 못 본다 — 0110 CHECK 가 막지만 코어도 접는다', () => {
    const orphan: SurveyAccessSubject = {
      ...COLUMNS['실사원(초대 설문)'].subject,
      fieldworkOrgId: null,
      fieldworkRole: null,
    };
    expect([...resolveSurveyCapabilities(orphan, target, { kind: 'fieldwork' })]).toEqual([]);
  });

  it('잘못 만든 참여 행으로 다른 열을 훔칠 수 없다 — 유형 게이트가 kind 보다 먼저다', () => {
    for (const kind of ['member', 'guest'] as const) {
      expect([
        ...resolveSurveyCapabilities(COLUMNS['실사원(초대 설문)'].subject, target, { kind }),
      ]).toEqual([]);
    }
  });

  it('배치 대기 설문은 초대·파생 시야 둘 다 닫는다', () => {
    const pending = survey({ teamId: null, assignmentStatus: 'assignment_pending' });
    expect([
      ...resolveSurveyCapabilities(COLUMNS['실사원(초대 설문)'].subject, pending, {
        kind: 'fieldwork',
      }),
    ]).toEqual([]);
    expect([
      ...resolveSurveyCapabilities(COLUMNS['실사 팀장(자기 업체)'].subject, pending, null, {
        fieldworkOrgInvited: true,
      }),
    ]).toEqual([]);
  });

  it('공개 범위는 실사 판정에 관여하지 않는다 — 초대가 유일한 자격이다', () => {
    const inviteOnly = survey({ visibility: 'invite_only' });
    expect([...resolveFor('실사원(초대 설문)', inviteOnly)].sort()).toEqual(
      tableColumn('실사원(초대 설문)'),
    );
  });
});
