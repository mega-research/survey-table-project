import { beforeEach, describe, expect, it, vi } from 'vitest';

const { attrsLimitMock, ownerFindFirstMock, piiRowsMock, selectMock, snapshotMock } = vi.hoisted(() => {
  const attrsLimitMock = vi.fn();
  const ownerFindFirstMock = vi.fn();
  // 개인정보 행 조회(read-models/respondent-contact-attrs) — from(contactPii).where() 를 바로 await 한다.
  const piiRowsMock = vi.fn();
  const snapshotMock = vi.fn();
  const selectMock = vi.fn(() => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({ limit: () => attrsLimitMock() }),
      }),
      where: async () => piiRowsMock(),
    }),
  }));
  return { attrsLimitMock, ownerFindFirstMock, piiRowsMock, selectMock, snapshotMock };
});

vi.mock('@/server/read-models/version-snapshot', () => ({
  loadPinnedVersionSnapshot: snapshotMock,
}));

vi.mock('@/db', () => ({
  db: {
    select: selectMock,
    query: { contactTargets: { findFirst: ownerFindFirstMock } },
  },
}));

import { encryptPii } from '@/lib/crypto/aes';
import { lookupContactAttrs } from '@/server/contacts/services/contact-attrs';

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
    piiRowsMock.mockReset();
    piiRowsMock.mockResolvedValue([]);
    snapshotMock.mockReset();
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

  it('개인정보 열은 발행본이 토큰·조건으로 읽는 것만 합쳐 보낸다', async () => {
    mockOwner();
    attrsLimitMock.mockResolvedValue([
      { id: 'ct-1', attrs: { 기업명: '가나' }, isTest: false, testModeEnabled: true },
    ]);
    piiRowsMock.mockResolvedValue([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: encryptPii('1234567890') },
      { fieldType: 'mobile', columnKey: '실무자 휴대번호', cipher: encryptPii('01012345678') },
    ]);
    snapshotMock.mockResolvedValue({
      questions: [{ tableRowsData: [{ cells: [{ defaultValueTemplate: '{{사업자등록번호}}' }] }] }],
    });

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).resolves.toEqual({ 기업명: '가나', 사업자등록번호: '123-45-67890' });
    expect(snapshotMock).toHaveBeenCalledWith(SURVEY_ID, false);
  });

  it('테스트 대상자에게는 테스트 버전(저장본)이 읽는 개인정보 열을 합쳐 보낸다', async () => {
    mockOwner();
    attrsLimitMock.mockResolvedValue([
      { id: 'ct-1', attrs: { 기업명: '가나' }, isTest: true, testModeEnabled: true },
    ]);
    piiRowsMock.mockResolvedValue([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: encryptPii('1234567890') },
    ]);
    snapshotMock.mockResolvedValue({
      questions: [{ tableRowsData: [{ cells: [{ defaultValueTemplate: '{{사업자등록번호}}' }] }] }],
    });

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).resolves.toEqual({ 기업명: '가나', 사업자등록번호: '123-45-67890' });
    expect(snapshotMock).toHaveBeenCalledWith(SURVEY_ID, true);
  });

  it('발행본이 없으면 개인정보 열을 하나도 보내지 않는다', async () => {
    mockOwner();
    attrsLimitMock.mockResolvedValue([
      { id: 'ct-1', attrs: { 기업명: '가나' }, isTest: false, testModeEnabled: true },
    ]);
    piiRowsMock.mockResolvedValue([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: encryptPii('1234567890') },
    ]);
    snapshotMock.mockResolvedValue(null);

    await expect(
      lookupContactAttrs({ surveyId: SURVEY_ID, inviteToken: INVITE_TOKEN }),
    ).resolves.toEqual({ 기업명: '가나' });
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
