import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactColumnScheme } from '@/shared/contracts/contacts';

// 이 스위트는 「목록 조립이 읽기 모델에 무엇을 넘기는가」만 본다 — 필터 해석과 조회 자체는 각자의
// 테스트(contact-filter-resolution.test · contacts-targets-roundtrip.realdb)가 진다.
vi.mock('./contact-filter-resolution', () => ({
  loadContactFilterContext: vi.fn(),
  resolveContactFilter: vi.fn(),
  contactFilterInputFromUrl: vi.fn(() => ({})),
}));
vi.mock('./contacts', () => ({
  listContactsForSurvey: vi.fn(),
}));

import { FIELDWORK_SHARE_ALL } from '../fieldwork-share-scope';
import { loadContactFilterContext, resolveContactFilter } from './contact-filter-resolution';
import { listContactsForSurvey } from './contacts';
import { loadContactsListPage } from './contacts-list-page';

function schemeOf(extra: Partial<ContactColumnScheme['columns'][number]>[] = []): ContactColumnScheme {
  return {
    version: 1,
    headerRow: 1,
    columns: [
      { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
      { key: 'ID', label: 'ID', source: 'attrs.ID', order: 2, defaultSort: true },
      { key: '대표자', label: '대표자', source: 'pii.대표자', order: 3 },
      { key: '전화번호', label: '전화번호', source: 'pii.전화번호', order: 4, hidden: true },
      ...(extra as ContactColumnScheme['columns']),
    ],
  };
}

function arrange(scheme: ContactColumnScheme | null) {
  vi.mocked(loadContactFilterContext).mockResolvedValue({
    scheme,
    resultCodes: [],
    assignmentOptions: [],
    columnCandidates: [],
  } as never);
  vi.mocked(resolveContactFilter).mockResolvedValue({ builderClauses: [], clauses: [] } as never);
  vi.mocked(listContactsForSurvey).mockResolvedValue({ rows: [], total: 0, page: 1 });
}

const baseArgs = {
  surveyId: 'sv-1',
  scope: 'real' as const,
  canViewMail: true,
  includeContactOwner: true,
  share: FIELDWORK_SHARE_ALL,
};

describe('loadContactsListPage — 기본 정렬 열과 개인정보 평문 열', () => {
  beforeEach(() => vi.clearAllMocks());

  it('주소에 정렬이 없으면 컬럼 설정의 기본 정렬 열 오름차순으로 연다', async () => {
    arrange(schemeOf());
    const page = await loadContactsListPage({ ...baseArgs, searchParams: {} });

    expect(listContactsForSurvey).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'attrs.ID', dir: 'asc' }),
    );
    // 화면의 머리글 화살표도 같은 값을 본다
    expect(page.sort).toBe('attrs.ID');
  });

  it('머리글을 눌러 바꾼 정렬(주소의 sort)이 있으면 그쪽이 이긴다', async () => {
    arrange(schemeOf());
    await loadContactsListPage({ ...baseArgs, searchParams: { sort: 'resid', dir: 'desc' } });

    expect(listContactsForSurvey).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'resid', dir: 'desc' }),
    );
  });

  it('기본 정렬 지정이 없거나 스킴이 없으면 종전대로 시스템ID 순이다', async () => {
    arrange(null);
    await loadContactsListPage({ ...baseArgs, searchParams: {} });

    expect(listContactsForSurvey).toHaveBeenCalledWith(expect.objectContaining({ sort: 'resid' }));
  });

  it('표시 중인 개인정보 열만 평문으로 싣도록 넘긴다 — 숨긴 열은 복호화하지 않는다', async () => {
    arrange(schemeOf());
    await loadContactsListPage({ ...baseArgs, searchParams: {} });

    expect(listContactsForSurvey).toHaveBeenCalledWith(
      expect.objectContaining({ plainPiiKeys: ['대표자'] }),
    );
  });

  it('외주 실사 링크 목록도 같다 — 메일 축 정렬은 여전히 시스템ID 로 접힌다', async () => {
    arrange(schemeOf());
    const page = await loadContactsListPage({
      ...baseArgs,
      canViewMail: false,
      includeContactOwner: false,
      searchParams: { sort: 'mailStatus' },
    });

    expect(page.sort).toBe('resid');
    expect(listContactsForSurvey).toHaveBeenCalledWith(
      expect.objectContaining({ plainPiiKeys: ['대표자'], includeAssignment: false }),
    );
  });
});
