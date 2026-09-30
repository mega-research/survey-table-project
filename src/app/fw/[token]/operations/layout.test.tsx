import { useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 이 트리는 `(internal)` 레이아웃 밖이라 그쪽이 여는 QueryProvider 를 물려받지 못한다.
// 그런데 조사 대상 leaf 는 내부 콘솔과 같은 표를 그리고, 그 표의 헤더 필터 팝오버가
// useQuery 를 쓴다 — provider 가 빠지면 화면이 「No QueryClient set」으로 무너진다
// (2026-09-30 실제로 그랬다). 표 단위 테스트는 저마다 provider 로 감싸 렌더해 이 빈칸을
// 보지 못하므로, 셸이 provider 를 연다는 사실을 여기서 직접 잰다.

vi.mock('@/server/page-fieldwork-link-access', () => ({
  assertFieldworkLinkPageAccess: vi.fn(async () => ({
    surveyId: '00000000-0000-4000-8000-000000000001',
    capabilities: ['survey.view', 'operations.view', 'contacts.view', 'contacts.writeAttempts'],
  })),
}));

vi.mock('@/server/survey-builder/services/survey-read', () => ({
  getSurveyById: vi.fn(async () => ({ title: '설문' })),
}));

// 셸의 나머지 조각은 관심사가 아니다 — provider 유무만 본다.
vi.mock('@/features/operations/operations-page-header', () => ({
  OperationsPageHeader: () => null,
}));
vi.mock('@/features/operations/operations-tab-strip', () => ({
  OperationsTabStrip: () => null,
}));
vi.mock('./link-sign-out-button', () => ({
  LinkSignOutButton: () => null,
}));

import FieldworkLinkOperationsLayout from './layout';

function NeedsQueryClient() {
  useQueryClient();
  return <p>query-client-ok</p>;
}

describe('외주 실사 링크 콘솔 셸', () => {
  it('하위 화면에 QueryClient 를 공급한다', async () => {
    const element = await FieldworkLinkOperationsLayout({
      children: <NeedsQueryClient />,
      params: Promise.resolve({ token: 'tok_abcdefghijklmnop' }),
    });

    render(element);

    expect(screen.getByText('query-client-ok')).toBeInTheDocument();
  });
});
