import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isGuestViewer } from '@/lib/auth/guest-viewer';
import {
  loadOperationsDataScope,
  resolveWriteScopeIsTest,
  testFlagForScope,
} from './data-scope';

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

// 이 브라우저의 「테스트 모드로 보기」 쿠키 — 테스트마다 켜고 끈다.
const { browserCookie } = vi.hoisted(() => ({ browserCookie: { value: undefined as string | undefined } }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'ops-test-view-11111111-1111-4111-8111-111111111111' && browserCookie.value !== undefined
        ? { name, value: browserCookie.value }
        : undefined,
  }),
}));

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
    browserCookie.value = '1';
  });

  it('어드민 세션은 테스트 모드 ON 이고 이 브라우저가 테스트 보기면 test 스코프를 받는다', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(false);
    rows.value = [{ enabled: true }];
    await expect(loadOperationsDataScope(SURVEY_ID)).resolves.toBe('test');
  });

  it('테스트 모드가 ON 이어도 이 브라우저가 테스트 보기를 켜지 않았으면 real 이다 — 다른 사람이 켠 테스트 모드', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(false);
    rows.value = [{ enabled: true }];
    browserCookie.value = undefined;
    await expect(loadOperationsDataScope(SURVEY_ID)).resolves.toBe('real');
  });

  it('쿠키 값이 1 이 아니면 테스트 보기로 치지 않는다', async () => {
    vi.mocked(isGuestViewer).mockResolvedValue(false);
    rows.value = [{ enabled: true }];
    browserCookie.value = '0';
    await expect(loadOperationsDataScope(SURVEY_ID)).resolves.toBe('real');
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

describe('resolveWriteScopeIsTest', () => {
  // 순수 동기 함수 — isGuest·쿠키는 호출부가 미리 구해 넘긴다.
  // mock 에 의존하지 않고 조합을 직접 인자로 검증한다.

  it('어드민(비게스트) 세션은 전역 플래그와 이 브라우저의 테스트 보기가 둘 다 켜졌을 때만 test 다', () => {
    expect(resolveWriteScopeIsTest(true, false, true)).toBe(true);
    expect(resolveWriteScopeIsTest(true, false, false)).toBe(false);
    expect(resolveWriteScopeIsTest(false, false, true)).toBe(false);
    expect(resolveWriteScopeIsTest(false, false, false)).toBe(false);
  });

  it('게스트 세션은 전역 플래그·쿠키와 무관하게 real 파티션에 쓴다', () => {
    expect(resolveWriteScopeIsTest(true, true, true)).toBe(false);
    expect(resolveWriteScopeIsTest(false, true, false)).toBe(false);
  });
});
