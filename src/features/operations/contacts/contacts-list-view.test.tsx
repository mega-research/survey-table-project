import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContactsListView } from '@/features/operations/contacts/contacts-list-view';
import type { ContactsListPageData } from '@/shared/contracts/contacts-io';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';

/**
 * 조사 대상 목록의 **액션 노출은 판정 결과가 정한다** (ADR-0026, 티켓 06).
 *
 * 화면 한 벌을 두 트리가 쓰므로, 갈리는 것은 주입된 capability 뿐이어야 한다. 근사치를
 * 따로 계산하면 서버가 막는 것과 화면이 감추는 것이 갈려 「보이는데 누르면 거부」가 된다.
 *
 * 여기서 보는 것은 **버튼이 그려지는가** 하나다. 표 내용·필터 동작은 각자의 스위트가 진다.
 */

/** 링크 주체가 갖는 넷 — 스펙 §8 의 「외주 링크」 열. */
const LINK_CAPS: readonly SurveyCapability[] = [
  'survey.view',
  'operations.view',
  'contacts.view',
  'contacts.writeAttempts',
];

const SCHEME = {
  columns: [
    { source: 'system.resid', label: '시스템ID', order: 0 },
    { source: 'attrs.회사명', label: '회사명', order: 1 },
  ],
} as unknown as ContactsListPageData['scheme'];

function data(overrides: Partial<ContactsListPageData> = {}): ContactsListPageData {
  return {
    scheme: SCHEME,
    resultCodes: [],
    columnCandidates: [{ source: 'attrs.회사명', label: '회사명' }],
    initialClauses: [],
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    sort: 'resid',
    dir: 'asc',
    hasFilter: false,
    isTestScope: false,
    ...overrides,
  };
}

function renderView(capabilities: readonly SurveyCapability[], pageData = data()) {
  return render(
    <ContactsListView
      surveyId="sv-1"
      basePath="/admin/surveys/sv-1/operations"
      capabilities={new Set(capabilities)}
      data={pageData}
    />,
  );
}

/** 명단을 **고치거나 가져가는** 액션 — 링크에게 하나도 그려지면 안 되는 것들. */
const MANAGE_ACTIONS = [/업로드/, /이월 응답 임포트/, /조사 대상 추가/, /다운로드|내보내기/, /컬럼 설정/];

describe('ContactsListView — capability 가 액션을 정한다', () => {
  it('전권 주체는 관리 액션을 전부 본다', () => {
    renderView(surveyCapabilityValues);
    for (const action of MANAGE_ACTIONS) {
      expect(screen.queryAllByText(action).length, `${action} 가 없다`).toBeGreaterThan(0);
    }
  });

  it('외주 링크에게는 관리 액션이 하나도 그려지지 않는다', () => {
    renderView(LINK_CAPS);
    for (const action of MANAGE_ACTIONS) {
      expect(screen.queryAllByText(action), `${action} 가 외주에게 보인다`).toEqual([]);
    }
  });

  it('외주 링크도 목록 자체와 총 건수는 본다 — 감추는 것은 액션뿐이다', () => {
    renderView(LINK_CAPS, data({ total: 1234 }));
    expect(screen.getByText('조사 대상 목록')).toBeTruthy();
    expect(screen.getByText('총 1,234건')).toBeTruthy();
  });

  it('명단이 없을 때 외주에게는 업로드를 권하지 않는다', () => {
    // 외주는 명단을 올릴 수 없다 — 「엑셀로 명단을 업로드하세요」는 할 수 없는 일을 시킨다.
    // 「아직 업로드된 조사 대상이 없습니다」라는 사실 진술은 남는다(버튼이 아니라 상태다).
    renderView(LINK_CAPS, data({ scheme: null }));
    expect(screen.queryAllByRole('link', { name: /업로드/ })).toEqual([]);
    expect(screen.getByText(/담당 연구원이 명단을 올리면/)).toBeTruthy();
  });

  it('내보내기는 contacts.manage 가 아니라 export.download 가 정한다', () => {
    // 둘을 한 값으로 묶으면 「명단은 못 고치는데 통째로 받아갈 수는 있는」 주체에서 갈린다.
    renderView(['contacts.view', 'export.download']);
    expect(screen.queryAllByText(/다운로드|내보내기/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/조사 대상 추가/)).toEqual([]);
  });
});
