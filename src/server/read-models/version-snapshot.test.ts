import { beforeEach, describe, expect, it, vi } from 'vitest';

const limit = vi.fn();
const where = vi.fn(() => ({ limit }));
const from = vi.fn(() => ({ where }));
const dbSelect = vi.fn((_selection: unknown) => ({ from }));

// 어느 버전 id 로 스냅샷을 읽었는지만 본다 — 조건식은 값만 남긴다.
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (_column: unknown, value: unknown) => ({ eqValue: value }),
}));

vi.mock('@/db', () => ({
  db: {
    select: (selection: unknown) => dbSelect(selection),
  },
}));

import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';

import {
  loadPinnedVersionSnapshot,
  loadVersionSnapshot,
  snapshotLookups,
  snapshotQuestions,
} from './version-snapshot';

describe('loadVersionSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('versionId 가 없으면 DB 조회 없이 null 을 반환한다', async () => {
    await expect(loadVersionSnapshot(null)).resolves.toBeNull();
    await expect(loadVersionSnapshot(undefined)).resolves.toBeNull();
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it('행이 없으면 null, 있으면 snapshot 을 그대로 돌려준다', async () => {
    limit.mockResolvedValueOnce([]);
    await expect(loadVersionSnapshot('v-1')).resolves.toBeNull();

    limit.mockResolvedValueOnce([{ snapshot: { title: '설문' } }]);
    await expect(loadVersionSnapshot('v-1')).resolves.toEqual({ title: '설문' });
  });

  it('prune 으로 snapshot 이 NULL 인 행은 null 로 접는다', async () => {
    limit.mockResolvedValueOnce([{ snapshot: null }]);
    await expect(loadVersionSnapshot('v-1')).resolves.toBeNull();
  });
});

describe('loadPinnedVersionSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('볼 버전이 없으면 두 번째 조회 없이 null 을 반환한다', async () => {
    limit.mockResolvedValueOnce([{ currentVersionId: null, testVersionId: null }]);

    await expect(loadPinnedVersionSnapshot('s-1', false)).resolves.toBeNull();
    expect(dbSelect).toHaveBeenCalledTimes(1);
  });

  it('실데이터는 현재 배포 버전의 snapshot 을 이어서 조회한다', async () => {
    limit.mockResolvedValueOnce([{ currentVersionId: 'v-9', testVersionId: 'v-test' }]);
    limit.mockResolvedValueOnce([{ snapshot: { title: '배포본' } }]);

    await expect(loadPinnedVersionSnapshot('s-1', false)).resolves.toEqual({ title: '배포본' });
    expect(where).toHaveBeenLastCalledWith({ eqValue: 'v-9' });
  });

  it('테스트 데이터는 지금 테스트 버전의 snapshot 을, 없으면 배포본을 조회한다', async () => {
    limit.mockResolvedValueOnce([{ currentVersionId: 'v-9', testVersionId: 'v-test' }]);
    limit.mockResolvedValueOnce([{ snapshot: { title: '저장본' } }]);
    await expect(loadPinnedVersionSnapshot('s-1', true)).resolves.toEqual({ title: '저장본' });
    expect(where).toHaveBeenLastCalledWith({ eqValue: 'v-test' });

    limit.mockResolvedValueOnce([{ currentVersionId: 'v-9', testVersionId: null }]);
    limit.mockResolvedValueOnce([{ snapshot: { title: '배포본' } }]);
    await expect(loadPinnedVersionSnapshot('s-1', true)).resolves.toEqual({ title: '배포본' });
    expect(where).toHaveBeenLastCalledWith({ eqValue: 'v-9' });
  });
});

describe('snapshotQuestions / snapshotLookups', () => {
  it('null 스냅샷과 비배열 필드를 모두 빈 배열로 접는다', () => {
    expect(snapshotQuestions(null)).toEqual([]);
    expect(snapshotLookups(null)).toEqual([]);

    const broken = { questions: '깨짐', lookups: 3 } as unknown as SurveyVersionSnapshot;
    expect(snapshotQuestions(broken)).toEqual([]);
    expect(snapshotLookups(broken)).toEqual([]);
  });

  it('배열이면 그대로 돌려준다', () => {
    const snap = {
      questions: [{ id: 'q1' }],
      lookups: [{ id: 'lut1' }],
    } as unknown as SurveyVersionSnapshot;

    expect(snapshotQuestions(snap)).toEqual([{ id: 'q1' }]);
    expect(snapshotLookups(snap)).toEqual([{ id: 'lut1' }]);
  });
});
