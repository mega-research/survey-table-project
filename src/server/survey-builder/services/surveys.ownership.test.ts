import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 새 설문의 팀 귀속 (역할 모델 v2 티켓 07).
 *
 * 설문을 만드는 경로는 셋(빌더 자동 생성·명시 생성·복제)이고 셋 다 소유·배치 컬럼을 채워야
 * 한다. 하나라도 빠지면 그 설문은 배치 대기로 떨어져 만든 사람조차 목록에서 볼 수 없다.
 */

const insertedValues: Record<string, unknown>[] = [];

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
  return { db: { query: { surveys: { findFirst: vi.fn(async () => undefined) } }, insert } };
});

vi.mock('@/server/work-scope', () => ({ resolveWorkScope: vi.fn() }));

vi.mock('@/lib/survey/survey-image-promote', () => ({
  promoteSurveyResponseHeader: vi.fn(async (v: unknown) => v ?? null),
}));

import { resolveWorkScope } from '@/server/work-scope';

import { SurveyOwnershipRequiredError, createSurvey, ensureSurveyInDb } from './surveys';

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
      settings: {},
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
      ensureSurveyInDb(actor, { id: 'draft-1', title: '제목 없는 설문', settings: {} }),
    ).rejects.toBeInstanceOf(SurveyOwnershipRequiredError);
  });
});
