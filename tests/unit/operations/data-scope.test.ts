import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { loadOperationsDataScope, testFlagForScope } from '@/lib/operations/data-scope.server';

// loadOperationsDataScope 는 db.select({...}).from(surveys).where(...).limit(1) 체인을 쓴다.
// 실 PG 없는 vitest 환경이라 반환 행만 갈아끼워 분기를 검증한다.
const { rows } = vi.hoisted(() => ({ rows: { value: [] as Array<{ enabled: boolean }> } }));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(rows.value) }),
      }),
    }),
  },
}));

vi.mock('@/lib/auth/guest-viewer', () => ({ isGuestViewer: vi.fn() }));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('testFlagForScope', () => {
  it('real은 false, test는 true로 고정한다', () => {
    expect(testFlagForScope('real')).toBe(false);
    expect(testFlagForScope('test')).toBe(true);
  });
});

describe('loadOperationsDataScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows.value = [];
  });

  it('어드민 세션은 테스트 모드 ON 이면 test 스코프를 받는다', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(false);
    rows.value = [{ enabled: true }];
    await expect(loadOperationsDataScope(SURVEY_ID)).resolves.toBe('test');
  });

  it('어드민 세션은 테스트 모드 OFF 면 real 스코프를 받는다', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(false);
    rows.value = [{ enabled: false }];
    await expect(loadOperationsDataScope(SURVEY_ID)).resolves.toBe('real');
  });

  it('게스트 세션은 테스트 모드 ON 이어도 real 스코프로 고정된다', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(true);
    rows.value = [{ enabled: true }];
    await expect(loadOperationsDataScope(SURVEY_ID)).resolves.toBe('real');
  });

  it('게스트 세션은 테스트 모드 OFF 면 그대로 real 스코프다', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(true);
    rows.value = [{ enabled: false }];
    await expect(loadOperationsDataScope(SURVEY_ID)).resolves.toBe('real');
  });

  it('게스트 세션이어도 설문이 없으면 throw 한다 (조기 return 로 검증을 건너뛰지 않는다)', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(true);
    rows.value = [];
    await expect(loadOperationsDataScope(SURVEY_ID)).rejects.toThrow('설문을 찾을 수 없습니다.');
  });
});
