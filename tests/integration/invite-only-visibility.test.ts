/**
 * invite_only 음성 스위트 — 같은 팀 팀원에게서 접근이 사라진다 (역할 모델 v2 티켓 16).
 *
 * 교차 팀 스위트(cross-team-idor-rpc)와 축이 다르다. 저쪽은 「남의 팀 설문 id 를 넣으면
 * 멈추는가」를 묻고, 이쪽은 **같은 팀 안에서** 공개 범위 한 컬럼을 뒤집었을 때 접근이 실제로
 * 사라지는가를 묻는다. v2 에서 invite_only 의 뜻이 「소유 팀 **팀원에게만** 숨김」으로
 * 바뀌었으므로(스펙 §3), 이 스위트가 고정하는 것은 두 문장이다.
 *
 *  ① 팀원은 전환 **전에는** 열 수 있었다 — 그래야 전환이 실제로 무언가를 닫았다는 뜻이 된다.
 *     관문이 통째로 빠져도, 반대로 관문이 언제나 막아도 이 짝 검사가 빨개진다.
 *  ② 팀원은 전환 **후에** 상세·편집·운영·분석 어디서도 NOT_FOUND 다 — FORBIDDEN 이 아니다.
 *     사유가 갈리면 id 스캔으로 숨긴 설문의 존재가 확인된다(denialReasonFor 의 계약).
 *
 * 목록 축은 **두 조각으로 나뉜다**. 판정(누가 invite_only 를 보는가)은 순수 함수라 여기서
 * 함께 고정하고, 그 판정이 실제 SQL 조건으로 옮겨졌는지는 목으로 증명되지 않아
 * cross-team-idor.realdb.test.ts·survey-sharing.realdb.test.ts 가 진다. 나눠 적는 이유는
 * 「기본 게이트가 목록에 대해 아무것도 보증하지 않는다」를 피하면서, 목이 증명할 수 없는 것을
 * 증명한 척하지 않기 위해서다.
 *
 * 소유자·팀장·슈퍼어드민이 전환 전후로 같다는 축은 코어 순수 함수 쪽
 * (src/server/survey-access.test.ts)이 매트릭스 열로 고정한다.
 */
import { createRouterClient } from '@orpc/server';
import { internalActorContext } from '@tests/helpers/rpc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from '@/server/router';
import { loadAccessSubject, loadSurveyCapabilities } from '@/server/survey-access';
import { buildSurveyScopeFilter } from '@/server/work-scope';

const IDS = vi.hoisted(() => ({
  /** 주체 — A팀 **팀원**. 소유자도 팀장도 슈퍼어드민도 아니다. */
  MEMBER_ID: '5a000000-0000-4000-8000-00000000ac01',
  TEAM_ID: '5a000000-0000-4000-8000-0000000a1111',
  /** 같은 팀의 다른 사람이 소유한 설문. */
  OWNER_ID: '5a000000-0000-4000-8000-0000000a0001',
  SURVEY_ID: '5a000000-0000-4000-8000-0000000f0001',
  SERVICE_REACHED: 'INVITE_ONLY: 관문을 지나 서비스가 DB 에 닿았다',
}));

/**
 * 지금 이 설문의 공개 범위 — 테스트가 뒤집는 유일한 값.
 *
 * 목 팩토리는 호이스트되므로 상태도 vi.hoisted 로 만든다. 「전환」을 컬럼 하나로 표현해야
 * 다른 조건(소유자·팀·배치 상태)이 그대로임을 스위트가 스스로 보증한다.
 */
const state = vi.hoisted(() => ({
  visibility: 'team' as 'team' | 'invite_only',
  /** 주체의 팀 역할 — 목록 판정 케이스만 팀장으로 올려 본다. */
  role: 'member' as 'member' | 'leader',
}));

vi.mock('@/db', async (importOriginal) => {
  // importOriginal 스프레드 필수 — `@/db` 는 스키마를 통째로 되내보낸다(db-stub 주석 참조).
  const actual = await importOriginal<typeof import('@/db')>();
  const { createDbStub } = await import('@tests/helpers/db-stub');
  const { surveys } = await import('@/db/schema');

  const surveyRow = () => ({
    id: IDS.SURVEY_ID,
    teamId: IDS.TEAM_ID,
    visibility: state.visibility,
    ownerUserId: IDS.OWNER_ID,
    assignmentStatus: 'assigned',
    deletedAt: null,
  });

  return {
    ...actual,
    db: createDbStub({
      reachedMessage: IDS.SERVICE_REACHED,
      rowsFor: (table) => (table === surveys ? [surveyRow()] : []),
      relationalRowFor: (table) => (table === 'surveys' ? surveyRow() : undefined),
    }),
  };
});

// 주체는 A팀 팀원 — 멤버십은 read-model 하나로 모여 있어 여기만 심으면 된다.
vi.mock('@/server/read-models/team-memberships', () => ({
  getActiveTeamMemberships: vi.fn(async () => [{ teamId: IDS.TEAM_ID, role: state.role }]),
  getTeamRole: vi.fn(async () => null),
}));

const { MEMBER_ID, SURVEY_ID } = IDS;

const client = createRouterClient(router, {
  context: internalActorContext({ id: MEMBER_ID, name: 'A팀 팀원' }),
});

/**
 * 전환으로 닫혀야 하는 표면 — 팀원이 팀 공개 설문에서 갖는 것들(TEAM_MEMBER_CAPS)을 고른다.
 *
 * 응답 상세·컨택·메일·export 는 팀원이 애초에 못 갖는 것들이라 이 축의 증거가 되지 못한다
 * (전환 전후가 똑같이 막힌다면 무엇이 닫혔는지 말해주지 않는다).
 */
const SURFACES: Record<string, { call: () => Promise<unknown>; capability: string }> = {
  '상세 조회': {
    capability: 'survey.view',
    call: () => client.surveyBuilder.read.withDetails({ surveyId: SURVEY_ID }),
  },
  편집: {
    capability: 'survey.edit',
    call: () => client.surveyBuilder.surveys.update({ surveyId: SURVEY_ID, data: {} }),
  },
  '운영 현황': {
    capability: 'operations.view',
    call: () => client.quota.get({ surveyId: SURVEY_ID }),
  },
  분석: {
    capability: 'analytics.view',
    call: () => client.analytics.stats.survey({ surveyId: SURVEY_ID }),
  },
};

const member = { id: MEMBER_ID, isSuperadmin: false, userType: 'internal' as const };

/**
 * 목록이 invite_only 를 보여줄지 정하는 순수 판정 — `getScopedSurveys` 가 이 플래그를 SQL
 * 조건으로 옮긴다(그 번역이 맞는지는 realdb 스위트가 본다).
 */
async function seesInviteOnly(user: typeof member): Promise<boolean> {
  const filter = buildSurveyScopeFilter(await loadAccessSubject(user), {
    kind: 'team',
    teamId: IDS.TEAM_ID,
  });
  return filter.kind === 'team' && filter.seesInviteOnly;
}

beforeEach(() => {
  state.visibility = 'team';
  state.role = 'member';
});

describe('전환 전 — 팀 공개 설문이라 팀원에게 열려 있다', () => {
  it('팀원이 팀 공개 설문의 capability 를 실제로 갖는다', async () => {
    const caps = await loadSurveyCapabilities(member, SURVEY_ID);
    for (const { capability } of Object.values(SURFACES)) {
      expect([...caps]).toContain(capability);
    }
  });

  it.each(Object.entries(SURFACES))('%s 표면이 관문에서 막히지 않는다', async (_name, surface) => {
    // 관문을 지나면 서비스가 목 db 에 닿아 사고(또는 빈 결과)로 끝난다 — 어느 쪽이든
    // NOT_FOUND 가 아니라는 것이 「열려 있었다」의 증거다.
    await surface.call().then(
      () => undefined,
      (err: unknown) => expect(err).not.toMatchObject({ code: 'NOT_FOUND' }),
    );
  });
});

describe('전환 후 — invite_only 는 같은 팀 팀원에게서 전부 사라진다', () => {
  beforeEach(() => {
    state.visibility = 'invite_only';
  });

  it('capability 가 하나도 남지 않는다', async () => {
    expect([...(await loadSurveyCapabilities(member, SURVEY_ID))]).toEqual([]);
  });

  it.each(Object.entries(SURFACES))('%s 표면이 NOT_FOUND 로 접힌다', async (_name, surface) => {
    // FORBIDDEN 이면 「있긴 있는데 못 본다」가 되어 숨긴 설문의 존재가 드러난다.
    await expect(surface.call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('목록 판정도 팀원에게는 숨기고 팀장·슈퍼어드민에게는 보인다', async () => {
    expect(await seesInviteOnly(member)).toBe(false);
    expect(await seesInviteOnly({ ...member, isSuperadmin: true })).toBe(true);

    state.role = 'leader';
    expect(await seesInviteOnly(member)).toBe(true);
  });
});
