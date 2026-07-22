import { beforeEach, describe, expect, it, vi } from 'vitest';

const { attrsLimitMock, ownerFindFirstMock, selectMock } = vi.hoisted(() => {
  const attrsLimitMock = vi.fn();
  const ownerFindFirstMock = vi.fn();
  const selectMock = vi.fn(() => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({ limit: () => attrsLimitMock() }),
      }),
    }),
  }));
  return { attrsLimitMock, ownerFindFirstMock, selectMock };
});

vi.mock('@/db', () => ({
  db: {
    select: selectMock,
    query: { contactTargets: { findFirst: ownerFindFirstMock } },
  },
}));

import { lookupContactAttrs } from '@/features/contacts/server/services/contact-attrs.service';

const SURVEY_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_SURVEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITE_TOKEN = '22222222-2222-2222-2222-222222222222';

function mockOwner(overrides: Record<string, unknown> = {}) {
  ownerFindFirstMock.mockResolvedValue({
    id: '33333333-3333-4333-8333-333333333333',
    surveyId: SURVEY_ID,
    isTest: false,
    respondedAt: null,
    survey: { testModeEnabled: true, deletedAt: null },
    ...overrides,
  });
}

describe('테스트 대상자 공개 진입 판정', () => {
  beforeEach(() => {
    attrsLimitMock.mockReset();
    attrsLimitMock.mockResolvedValue([]);
    ownerFindFirstMock.mockReset();
    selectMock.mockClear();
  });

  it('실제 대상자 attrs는 테스트 모드 ON이어도 계속 조회한다', async () => {
    mockOwner();
    attrsLimitMock.mockResolvedValue([{ attrs: { name: '실제 대상자' }, isTest: false, testModeEnabled: true }]);

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).resolves.toEqual({ name: '실제 대상자' });
  });

  it('OFF인 테스트 대상자 attrs는 메시지가 아닌 식별 코드로 종료한다', async () => {
    mockOwner({
      isTest: true,
      survey: { testModeEnabled: false, deletedAt: null },
    });
    attrsLimitMock.mockResolvedValue([{ attrs: { name: '테스트 대상자' }, isTest: true, testModeEnabled: false }]);

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).rejects.toMatchObject({ code: 'INVALID_TEST_LINK' });
  });

  it('교차 설문 테스트 owner는 요청 설문 조건으로 종류를 잃기 전에 종료한다', async () => {
    mockOwner({
      surveyId: OTHER_SURVEY_ID,
      isTest: true,
      survey: { testModeEnabled: true, deletedAt: null },
    });

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).rejects.toMatchObject({ code: 'INVALID_TEST_LINK' });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('교차 설문 실제 owner는 기존처럼 null로 익명 폴백한다', async () => {
    mockOwner({ surveyId: OTHER_SURVEY_ID, isTest: false });

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).resolves.toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('삭제된 설문의 테스트 owner는 INVALID_TEST_LINK로 종료한다', async () => {
    mockOwner({
      isTest: true,
      survey: {
        testModeEnabled: true,
        deletedAt: new Date('2026-07-22T01:00:00.000Z'),
      },
    });

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).rejects.toMatchObject({ code: 'INVALID_TEST_LINK' });
  });

  it('owner 판정 후 대상자가 삭제되는 race도 테스트 링크를 null로 강등하지 않는다', async () => {
    mockOwner({ isTest: true });
    attrsLimitMock.mockResolvedValue([]);

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).rejects.toMatchObject({ code: 'INVALID_TEST_LINK' });
  });
});
