import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactColumnDef } from '@/shared/contracts/contacts';

const { surveyMock, testSchemeMock } = vi.hoisted(() => ({
  surveyMock: vi.fn(),
  testSchemeMock: vi.fn(),
}));

vi.mock('@/server/read-models/survey-structure', () => ({ getSurveyById: surveyMock }));
vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => testSchemeMock() }) }),
    }),
  },
}));

import { getVariableCatalog } from '@/server/read-models/variable-catalog';

const attr = (key: string): ContactColumnDef => ({ key, label: key, source: `attrs.${key}`, order: 1 });
const pii = (key: string, respondentVisible = false): ContactColumnDef => ({
  key,
  label: key,
  source: `pii.${key}`,
  order: 2,
  piiType: 'biz_number',
  ...(respondentVisible ? { respondentVisible } : {}),
});
const scheme = (columns: ContactColumnDef[]) => ({ version: 1, headerRow: 1, columns });

describe('getVariableCatalog — 응답 화면 노출 개인정보 열', () => {
  beforeEach(() => vi.clearAllMocks());

  it('설문 목적이면 실·테스트 스킴 어느 쪽에서 켰든 노출 열을 싣는다', async () => {
    surveyMock.mockResolvedValue({ contactColumns: scheme([attr('기업명'), pii('사업자등록번호')]) });
    testSchemeMock.mockResolvedValue([{ test: scheme([pii('사업자등록번호', true)]) }]);

    const keys = (await getVariableCatalog('sv-test-only', { purpose: 'survey' })).map((v) => v.key);
    expect(keys).toEqual(['기업명', '사업자등록번호']);
  });

  it('켜지 않은 개인정보 열은 싣지 않는다', async () => {
    surveyMock.mockResolvedValue({ contactColumns: scheme([attr('기업명'), pii('사업자등록번호')]) });
    testSchemeMock.mockResolvedValue([{ test: null }]);

    const keys = (await getVariableCatalog('sv-off', { purpose: 'survey' })).map((v) => v.key);
    expect(keys).toEqual(['기업명']);
  });

  it('메일 목적에는 싣지 않는다 — 메일 본문은 명단 값을 합치지 않는다', async () => {
    surveyMock.mockResolvedValue({ contactColumns: scheme([attr('기업명'), pii('사업자등록번호', true)]) });

    const keys = (await getVariableCatalog('sv-mail')).map((v) => v.key);
    expect(keys).toEqual(['기업명', 'invite_link']);
    expect(testSchemeMock).not.toHaveBeenCalled();
  });
});
