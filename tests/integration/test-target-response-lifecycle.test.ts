import { beforeEach, describe, expect, it, vi } from 'vitest';

const { attrsLimitMock, scopeLimitMock, selectMock } = vi.hoisted(() => {
  const attrsLimitMock = vi.fn();
  const scopeLimitMock = vi.fn();
  const selectMock = vi.fn((projection: Record<string, unknown>) => {
    const limitMock = 'enabled' in projection ? scopeLimitMock : attrsLimitMock;
    return {
      from: () => ({
        where: () => ({ limit: () => limitMock() }),
        innerJoin: () => ({
          where: () => ({ limit: () => limitMock() }),
        }),
      }),
    };
  });
  return { attrsLimitMock, scopeLimitMock, selectMock };
});

vi.mock('@/db', () => ({
  db: { select: selectMock },
}));

import { lookupContactAttrs } from '@/features/contacts/server/services/contact-attrs.service';

const SURVEY_ID = '11111111-1111-1111-1111-111111111111';
const INVITE_TOKEN = '22222222-2222-2222-2222-222222222222';

describe('테스트 대상자 공개 진입 판정', () => {
  beforeEach(() => {
    attrsLimitMock.mockReset();
    scopeLimitMock.mockReset();
    selectMock.mockClear();
  });

  it('실제 대상자 attrs는 테스트 모드 ON이어도 계속 조회한다', async () => {
    scopeLimitMock.mockResolvedValue([{ enabled: true }]);
    attrsLimitMock.mockResolvedValue([{ attrs: { name: '실제 대상자' }, isTest: false, testModeEnabled: true }]);

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).resolves.toEqual({ name: '실제 대상자' });
  });

  it('OFF인 테스트 대상자 attrs는 INVALID_TEST_LINK로 종료한다', async () => {
    scopeLimitMock.mockResolvedValue([{ enabled: false }]);
    attrsLimitMock.mockResolvedValue([{ attrs: { name: '테스트 대상자' }, isTest: true, testModeEnabled: false }]);

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).rejects.toThrow('INVALID_TEST_LINK');
  });
});
