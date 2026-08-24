import { beforeEach, describe, expect, it, vi } from 'vitest';

const limit = vi.fn();
const where = vi.fn(() => ({ limit }));
const from = vi.fn(() => ({ where }));
const dbSelect = vi.fn((_selection: unknown) => ({ from }));

vi.mock('@/db', () => ({
  db: {
    select: (selection: unknown) => dbSelect(selection),
  },
}));

import {
  type StoredVersionSnapshot,
  loadCurrentVersionSnapshot,
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

describe('loadCurrentVersionSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('현재 배포 버전이 없으면 두 번째 조회 없이 null 을 반환한다', async () => {
    limit.mockResolvedValueOnce([{ currentVersionId: null }]);

    await expect(loadCurrentVersionSnapshot('s-1')).resolves.toBeNull();
    expect(dbSelect).toHaveBeenCalledTimes(1);
  });

  it('현재 배포 버전이 있으면 그 버전의 snapshot 을 이어서 조회한다', async () => {
    limit.mockResolvedValueOnce([{ currentVersionId: 'v-9' }]);
    limit.mockResolvedValueOnce([{ snapshot: { title: '설문' } }]);

    await expect(loadCurrentVersionSnapshot('s-1')).resolves.toEqual({ title: '설문' });
    expect(dbSelect).toHaveBeenCalledTimes(2);
  });
});

describe('snapshotQuestions / snapshotLookups', () => {
  it('null 스냅샷과 비배열 필드를 모두 빈 배열로 접는다', () => {
    expect(snapshotQuestions(null)).toEqual([]);
    expect(snapshotLookups(null)).toEqual([]);

    const broken = { questions: '깨짐', lookups: 3 } as unknown as StoredVersionSnapshot;
    expect(snapshotQuestions(broken)).toEqual([]);
    expect(snapshotLookups(broken)).toEqual([]);
  });

  it('배열이면 그대로 돌려준다', () => {
    const snap = {
      questions: [{ id: 'q1' }],
      lookups: [{ id: 'lut1' }],
    } as unknown as StoredVersionSnapshot;

    expect(snapshotQuestions(snap)).toEqual([{ id: 'q1' }]);
    expect(snapshotLookups(snap)).toEqual([{ id: 'lut1' }]);
  });
});
