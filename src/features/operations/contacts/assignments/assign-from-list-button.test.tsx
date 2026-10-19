import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const previewFromList = vi.fn();
const assignFromList = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      assignments: {
        previewFromList: (...a: unknown[]) => previewFromList(...a),
        assignFromList: (...a: unknown[]) => assignFromList(...a),
      },
    },
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('col=system.resid&q=1-100&op=&page=2'),
}));

import { AssignFromListButton } from './assign-from-list-button';

const SURVEY = '00000000-0000-4000-8000-000000000001';
const OPTIONS = [
  { id: 'a10', name: '10차', order: 1 },
  { id: 'a11', name: '11차', order: 2 },
];

function renderButton() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AssignFromListButton surveyId={SURVEY} total={30} filtered options={OPTIONS} />
    </QueryClientProvider>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByRole('combobox', { name: '배정할 컨택원' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('AssignFromListButton', () => {
  beforeAll(() => {
    // Radix Select 가 jsdom 에 없는 포인터·스크롤 API 를 부른다.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false) as never;
    Element.prototype.releasePointerCapture = vi.fn();
  });
  beforeEach(() => vi.clearAllMocks());

  it('얹기 — 컨택원별 변화 인원을 보이고 주소의 필터를 그대로 보낸다', async () => {
    const user = userEvent.setup();
    previewFromList.mockResolvedValue({
      matched: 30,
      targetCurrent: 42,
      groups: [
        { id: 'a10', name: '10차', count: 5 },
        { id: 'a11', name: '11차', count: 2 },
        { id: null, name: null, count: 23 },
      ],
    });
    assignFromList.mockResolvedValue({ matched: 30, targetCurrent: 42, groups: [] });
    renderButton();
    await user.click(screen.getByRole('button', { name: '검색 결과 30명을 컨택원에 배정' }));
    await pick(user, /^11차$/);
    expect(await screen.findByText('11차 42명 → 70명')).toBeInTheDocument();
    expect(screen.getByText(/다른 컨택원에서 옮겨 옴 5명 \(10차 5\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '배정' }));
    await waitFor(() =>
      expect(assignFromList).toHaveBeenCalledWith({
        surveyId: SURVEY,
        assignmentId: 'a11',
        filter: { col: ['system.resid'], q: ['1-100'], op: [''], hcol: [], hm: [], hv: [] },
      }),
    );
  });

  it('풀기 — 컨택원별로 배정 없음이 될 인원을 보인다', async () => {
    const user = userEvent.setup();
    previewFromList.mockResolvedValue({
      matched: 30,
      targetCurrent: null,
      groups: [
        { id: 'a10', name: '10차', count: 5 },
        { id: 'a11', name: '11차', count: 12 },
        { id: null, name: null, count: 13 },
      ],
    });
    renderButton();
    await user.click(screen.getByRole('button', { name: /컨택원에 배정/ }));
    await pick(user, /배정 없음/);
    expect(await screen.findByText('10차 5명 · 11차 12명이 배정 없음이 됩니다.')).toBeInTheDocument();
    expect(previewFromList).toHaveBeenCalledWith(expect.objectContaining({ assignmentId: null }));
  });
});
