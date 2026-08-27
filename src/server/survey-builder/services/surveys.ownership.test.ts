import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 새 설문의 팀 귀속 (역할 모델 v2 티켓 07).
 *
 * 설문을 만드는 경로는 셋(빌더 자동 생성·명시 생성·복제)이고 셋 다 소유·배치 컬럼을 채워야
 * 한다. 하나라도 빠지면 그 설문은 배치 대기로 떨어져 만든 사람조차 목록에서 볼 수 없다.
 */

const insertedValues: Record<string, unknown>[] = [];
/** 소유 팀이 active 인가 — resolveNewSurveyOwnership 의 마지막 확인(티켓 13). 기본은 활성. */
const activeTeamRows: { id: string }[] = [{ id: 'team-1' }];

vi.mock('@/db', () => {
  const insert = () => ({
    values: (v: Record<string, unknown>) => {
      insertedValues.push(v);
      return {
        returning: async () => [{ id: 'new-survey', ...v }],
        then: (resolve: (value: unknown) => unknown) => resolve(undefined),
      };
    },
  });
  // 팀 active 확인은 INSERT 와 같은 트랜잭션에서 FOR SHARE 로 잠근다(티켓 13).
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => activeTeamRows,
        for: async () => activeTeamRows,
      }),
    }),
  });
  const executor = {
    query: { surveys: { findFirst: vi.fn(async () => undefined) } },
    insert,
    select,
  };
  return {
    db: {
      ...executor,
      transaction: async (fn: (tx: unknown) => unknown) => fn(executor),
    },
  };
});

vi.mock('@/server/work-scope', () => ({ resolveWorkScope: vi.fn() }));

vi.mock('@/server/survey-access', () => ({
  assertSurveyCapability: vi.fn(),
  SurveyAccessError: class extends Error {},
}));

vi.mock('@/server/read-models/survey-structure', () => ({ getSurveyById: vi.fn() }));

vi.mock('@/lib/survey/survey-image-promote', () => ({
  promoteSurveyResponseHeader: vi.fn(async (v: unknown) => v ?? null),
}));

import { db } from '@/db';
import { getSurveyById } from '@/server/read-models/survey-structure';
import { assertSurveyCapability } from '@/server/survey-access';
import { resolveWorkScope } from '@/server/work-scope';

import { SurveyOwnershipRequiredError } from '../domain/survey';
import { createSurvey, duplicateSurvey, ensureSurveyInDb } from './surveys';

const SETTINGS = {
  isPublic: true,
  allowMultipleResponses: false,
  showProgressBar: true,
  shuffleQuestions: false,
  requireLogin: false,
  thankYouMessage: '감사합니다',
};

const actor = { id: 'u-1', isSuperadmin: false, userType: 'internal' as const };

beforeEach(() => {
  vi.clearAllMocks();
  insertedValues.length = 0;
  vi.mocked(resolveWorkScope).mockResolvedValue({ kind: 'team', teamId: 'team-1' });
});

describe('createSurvey — 팀 귀속', () => {
  it('해석된 작업 범위의 팀에 배치되고 만든 사람이 소유자가 된다', async () => {
    await createSurvey(actor, { title: '새 설문', scope: 'team-1' });

    expect(resolveWorkScope).toHaveBeenCalledWith(actor, 'team-1');
    expect(insertedValues[0]).toMatchObject({
      teamId: 'team-1',
      ownerUserId: 'u-1',
      createdBy: 'u-1',
      assignmentStatus: 'assigned',
    });
  });

  it('시스템 전체 보기에서는 만들 수 없다 — 소유 팀을 먼저 골라야 한다', async () => {
    vi.mocked(resolveWorkScope).mockResolvedValue({ kind: 'system' });
    await expect(createSurvey(actor, { title: '새 설문' })).rejects.toBeInstanceOf(
      SurveyOwnershipRequiredError,
    );
    expect(insertedValues).toEqual([]);
  });

  it('팀 미배치 사용자는 만들 수 없다', async () => {
    vi.mocked(resolveWorkScope).mockResolvedValue({ kind: 'none' });
    await expect(createSurvey(actor, { title: '새 설문' })).rejects.toBeInstanceOf(
      SurveyOwnershipRequiredError,
    );
  });
});

describe('ensureSurveyInDb — 빌더 자동 생성도 같은 귀속을 받는다', () => {
  it('빈 설문이라도 팀·소유자 없이 만들어지지 않는다', async () => {
    await ensureSurveyInDb(actor, {
      id: 'draft-1',
      title: '제목 없는 설문',
      settings: SETTINGS,
      scope: 'team-1',
    });

    expect(insertedValues[0]).toMatchObject({
      teamId: 'team-1',
      ownerUserId: 'u-1',
      assignmentStatus: 'assigned',
    });
  });

  it('범위를 정할 수 없으면 자동 생성도 막힌다', async () => {
    vi.mocked(resolveWorkScope).mockResolvedValue({ kind: 'none' });
    await expect(
      ensureSurveyInDb(actor, { id: 'draft-1', title: '제목 없는 설문', settings: SETTINGS }),
    ).rejects.toBeInstanceOf(SurveyOwnershipRequiredError);
  });
});

describe('duplicateSurvey — 원본 접근 권한이 먼저다', () => {
  it('원본 편집 권한이 없으면 복제하지 않는다 — 읽기 전에 관문을 통과해야 한다', async () => {
    // 이 검사가 없으면 id 만 아는 내부 사용자가 타 팀 설문을 복제해 그 사본의 소유자가 된다.
    const denied = new Error('forbidden');
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(denied);

    await expect(duplicateSurvey(actor, { surveyId: 'other-team-survey' })).rejects.toBe(denied);
    expect(getSurveyById).not.toHaveBeenCalled();
  });

  it('관문을 통과하면 원본 조회로 넘어간다', async () => {
    vi.mocked(assertSurveyCapability).mockResolvedValueOnce(undefined);
    vi.mocked(getSurveyById).mockResolvedValueOnce(undefined as never);

    await expect(duplicateSurvey(actor, { surveyId: 'sv-1' })).resolves.toBeNull();
    expect(assertSurveyCapability).toHaveBeenCalledWith(actor, 'sv-1', 'survey.edit');
  });
});

describe('ensureSurveyInDb — 기존 행은 존재 오라클을 봉인한다', () => {
  it('이미 있는 설문이면 편집 관문을 지나야 { created: false } 를 돌려준다', async () => {
    vi.mocked(db.query.surveys.findFirst).mockResolvedValueOnce({ id: 'existing-1' } as never);
    vi.mocked(assertSurveyCapability).mockResolvedValueOnce(undefined);

    await expect(
      ensureSurveyInDb(actor, { id: 'existing-1', title: '제목', settings: SETTINGS }),
    ).resolves.toEqual({ surveyId: 'existing-1', created: false });
    expect(assertSurveyCapability).toHaveBeenCalledWith(actor, 'existing-1', 'survey.edit');
  });

  it('관문이 거부하면 존재 여부(created:false)조차 돌려주지 않는다', async () => {
    vi.mocked(db.query.surveys.findFirst).mockResolvedValueOnce({ id: 'other-team' } as never);
    const denied = new Error('not_found');
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(denied);

    await expect(
      ensureSurveyInDb(actor, { id: 'other-team', title: '제목', settings: SETTINGS }),
    ).rejects.toBe(denied);
    expect(insertedValues).toEqual([]);
  });
});

/**
 * 해산된 팀에는 아무것도 새로 붙지 않는다 (티켓 13).
 *
 * 일반 사용자는 유효 소속에서 archived 팀이 빠져 범위가 none 으로 접히지만, **슈퍼어드민의
 * 팀 범위는 멤버십으로 걸러지지 않는다** — work_scope 쿠키에 남은 해산 팀 id 가 UUID 형식
 * 검사만 지나고 통과한다. 그 상태로 만든 설문은 배치 대기도 아니면서 슈퍼어드민 외에는
 * 아무도 못 보는 유령이 된다.
 */
describe('해산된 팀에는 새 설문이 붙지 않는다', () => {
  beforeEach(() => {
    vi.mocked(resolveWorkScope).mockResolvedValue({ kind: 'team', teamId: 'team-1' });
    // 조회 결과 0행 = 그 teamId 가 active 팀이 아니다(해산됨 또는 없음).
    activeTeamRows.length = 0;
  });

  it('createSurvey 가 거부한다', async () => {
    await expect(createSurvey(actor, { title: '유령 설문' } as never)).rejects.toBeInstanceOf(
      SurveyOwnershipRequiredError,
    );
    expect(insertedValues).toHaveLength(0);
  });

  it('빌더 자동 생성(ensureSurveyInDb)도 거부한다', async () => {
    vi.mocked(getSurveyById).mockResolvedValue(null as never);
    await expect(
      ensureSurveyInDb(actor, { id: 'ghost', title: '유령', settings: {} } as never),
    ).rejects.toBeInstanceOf(SurveyOwnershipRequiredError);
    expect(insertedValues).toHaveLength(0);
  });
});
