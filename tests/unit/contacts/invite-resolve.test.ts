import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.select({...}).from().innerJoin().where().limit(1) 체인을 mock.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로 참조 변수도 vi.hoisted 로 함께 호이스팅.
const { limitMock, selectMock } = vi.hoisted(() => {
  const limitMock = vi.fn();
  const selectMock = vi.fn(() => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: () => limitMock(),
        }),
      }),
    }),
  }));
  return { limitMock, selectMock };
});

vi.mock('@/db', () => ({
  db: { select: selectMock },
}));

import { resolveInviteCode } from '@/features/contacts/server/services/contact-invite.service';

beforeEach(() => {
  selectMock.mockClear();
  limitMock.mockReset();
});

describe('resolveInviteCode', () => {
  it('빈 코드는 DB 조회 없이 null 을 반환한다', async () => {
    const result = await resolveInviteCode('');
    expect(result).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('공개 설문은 slug 를 accessIdentifier 로 매핑한다', async () => {
    limitMock.mockResolvedValue([
      { surveyId: 's1', slug: 'game-survey', privateToken: 'pt1', isPublic: true, inviteToken: 'it1', isTest: false, testModeEnabled: true },
    ]);
    const result = await resolveInviteCode('code123');
    expect(result).toEqual({ kind: 'valid', accessIdentifier: 'game-survey', inviteToken: 'it1' });
  });

  it('비공개 설문은 privateToken 을 accessIdentifier 로 매핑한다', async () => {
    limitMock.mockResolvedValue([
      { surveyId: 's1', slug: 'game-survey', privateToken: 'pt1', isPublic: false, inviteToken: 'it1', isTest: false, testModeEnabled: false },
    ]);
    const result = await resolveInviteCode('code123');
    expect(result).toEqual({ kind: 'valid', accessIdentifier: 'pt1', inviteToken: 'it1' });
  });

  it('테스트 대상자는 테스트 모드가 ON일 때만 valid로 매핑한다', async () => {
    limitMock.mockResolvedValue([
      { surveyId: 's1', slug: 'game-survey', privateToken: 'pt1', isPublic: true, inviteToken: 'it1', isTest: true, testModeEnabled: true },
    ]);

    expect(await resolveInviteCode('test-code')).toEqual({
      kind: 'valid',
      accessIdentifier: 'game-survey',
      inviteToken: 'it1',
    });
  });

  it('OFF인 테스트 대상자는 invalid_test로 종료한다', async () => {
    limitMock.mockResolvedValue([
      { surveyId: 's1', slug: 'game-survey', privateToken: 'pt1', isPublic: true, inviteToken: 'it1', isTest: true, testModeEnabled: false },
    ]);

    expect(await resolveInviteCode('stale-test-code')).toEqual({ kind: 'invalid_test' });
  });

  it('매칭 없으면 null 을 반환한다', async () => {
    limitMock.mockResolvedValue([]);
    const result = await resolveInviteCode('nope');
    expect(result).toBeNull();
  });
});
