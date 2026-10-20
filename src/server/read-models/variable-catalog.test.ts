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
const pii = (key: string): ContactColumnDef => ({
  key,
  label: key,
  source: `pii.${key}`,
  order: 2,
  piiType: 'biz_number',
});
const scheme = (columns: ContactColumnDef[]) => ({ version: 1, headerRow: 1, columns });

describe('getVariableCatalog — 개인정보 열', () => {
  beforeEach(() => vi.clearAllMocks());

  it('설문 목적이면 실·테스트 스킴의 개인정보 열을 설정 없이 전부 싣는다', async () => {
    surveyMock.mockResolvedValue({
      contactColumns: scheme([attr('기업명'), pii('사업자등록번호'), pii('대표자명')]),
    });
    testSchemeMock.mockResolvedValue([{ test: scheme([pii('사업자등록번호'), pii('테스트전용')]) }]);

    const keys = (await getVariableCatalog('sv-survey', { purpose: 'survey' })).map((v) => v.key);
    expect(keys).toEqual(['기업명', '사업자등록번호', '대표자명', '테스트전용']);
  });

  it('메일 목적에는 싣지 않는다 — 메일 본문은 명단 값을 합치지 않는다', async () => {
    surveyMock.mockResolvedValue({ contactColumns: scheme([attr('기업명'), pii('사업자등록번호')]) });

    const keys = (await getVariableCatalog('sv-mail')).map((v) => v.key);
    expect(keys).toEqual(['기업명', 'invite_link']);
    expect(testSchemeMock).not.toHaveBeenCalled();
  });
});
