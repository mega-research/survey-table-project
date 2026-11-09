import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareEditor } from './share-editor';

const preview = vi.fn();
const apply = vi.fn();
const clear = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      fieldworkShares: {
        preview: (...a: unknown[]) => preview(...a),
        apply: (...a: unknown[]) => apply(...a),
        clear: (...a: unknown[]) => clear(...a),
        facets: vi.fn(async () => ({ kind: 'many' })),
        matches: vi.fn(async () => ({ rows: [], total: 0, page: 1, pageSize: 10 })),
      },
      idLists: { create: vi.fn() },
      attrValues: { nonNumericCount: vi.fn() },
    },
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const SURVEY = '00000000-0000-4000-8000-000000000001';
const LINK = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

function renderEditor(link: {
  divided: boolean;
  count: number;
  lastClauses: Array<{ source: string; value: string; op: '' | 'AND' | 'OR' }> | null;
}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ShareEditor
        surveyId={SURVEY}
        link={{ id: LINK, name: '프롬', ...link }}
        columnCandidates={[
          { source: 'system.resid', label: '시스템ID' },
          { source: 'attrs.지역', label: '지역' },
        ]}
        resultCodeOptions={[]}
        displayColumn={{ source: 'attrs.지역', label: '지역' }}
      />
    </QueryClientProvider>,
  );
}

describe('ShareEditor — 외주 담당 범위 적용', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue({
      matched: 100,
      current: 0,
      incoming: 80,
      overlap: 20,
      fromOthers: [{ linkId: OTHER, name: '프라임', count: 20 }],
      leaving: 0,
    });
  });

  const lastClauses = [{ source: 'system.resid', value: '1-100', op: '' as const }];

  it('나누지 않은 링크는 「설문 전체」로 보이고 범위 없애기 버튼이 없다', () => {
    renderEditor({ divided: false, count: 0, lastClauses: null });
    expect(screen.getByText(/설문 전체 — 아직 나누지 않아/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '담당 범위 없애기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '범위 적용' })).toBeDisabled();
  });

  it('겹치는 대상이 있으면 처리를 고르기 전에는 적용할 수 없고, 고른 「가져오기」로 같은 조건을 적용한다', async () => {
    const user = userEvent.setup();
    apply.mockResolvedValue({
      matched: 100,
      current: 0,
      incoming: 80,
      overlap: 20,
      fromOthers: [],
      leaving: 0,
      overlapChoice: 'take',
      after: 100,
    });
    renderEditor({ divided: false, count: 0, lastClauses });
    expect(await screen.findByText('100명', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('프라임 링크에 이미 20명')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({ surveyId: SURVEY, linkId: LINK, clauses: lastClauses });

    const group = screen.getByRole('radiogroup', { name: '겹치는 대상 20명' });
    expect(
      within(group)
        .getAllByRole('radio')
        .every((r) => !(r as HTMLInputElement).checked),
    ).toBe(true);
    expect(screen.getByRole('button', { name: '범위 적용' })).toBeDisabled();

    await user.click(within(group).getByRole('radio', { name: /가져오기/ }));
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    expect(screen.getByText('프롬 0명 → 100명.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('새로 들어옴 80명 (어느 링크에도 없던 대상)')).toBeInTheDocument();
    expect(screen.getByText('다른 링크에서 가져옴 20명 (프라임 20)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        surveyId: SURVEY,
        linkId: LINK,
        clauses: lastClauses,
        overlap: 'take',
      }),
    );
  });

  it('남겨 두기를 고르면 확인 창이 겹치는 대상만큼 적은 인원과 남겨 둘 링크를 보인다', async () => {
    const user = userEvent.setup();
    apply.mockResolvedValue({
      matched: 100,
      current: 0,
      incoming: 80,
      overlap: 20,
      fromOthers: [],
      leaving: 0,
      overlapChoice: 'keep',
      after: 80,
    });
    renderEditor({ divided: false, count: 0, lastClauses });
    await screen.findByText('100명', undefined, { timeout: 5000 });
    await user.click(screen.getByRole('radio', { name: /남겨 두기/ }));
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    expect(screen.getByText('프롬 0명 → 80명.', { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText('남겨 둠 20명 (프라임 20) — 원래 링크에 두고 이쪽에 넣지 않습니다'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ overlap: 'keep' })),
    );
  });

  it('같이 맡기기를 고르면 확인 창이 두 링크 모두에 보인다고 알린다', async () => {
    const user = userEvent.setup();
    renderEditor({ divided: false, count: 0, lastClauses });
    await screen.findByText('100명', undefined, { timeout: 5000 });
    await user.click(screen.getByRole('radio', { name: /같이 맡기기/ }));
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    expect(screen.getByText('프롬 0명 → 100명.', { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText('같이 맡김 20명 (프라임 20) — 두 링크의 외주 화면에 모두 보입니다'),
    ).toBeInTheDocument();
  });

  it('겹치는 대상이 없으면 처리를 묻지 않고, 다른 링크를 건드리지 않는 남겨 두기로 보낸다', async () => {
    const user = userEvent.setup();
    preview.mockResolvedValue({
      matched: 100,
      current: 0,
      incoming: 100,
      overlap: 0,
      fromOthers: [],
      leaving: 0,
    });
    apply.mockResolvedValue({
      matched: 100,
      current: 0,
      incoming: 100,
      overlap: 0,
      fromOthers: [],
      leaving: 0,
      overlapChoice: 'keep',
      after: 100,
    });
    renderEditor({ divided: false, count: 0, lastClauses });
    await screen.findByText('100명', undefined, { timeout: 5000 });
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText(/링크에서 가져옴|남겨 둠|같이 맡김/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        surveyId: SURVEY,
        linkId: LINK,
        clauses: lastClauses,
        overlap: 'keep',
      }),
    );
  });

  it('나눈 링크는 지금 인원을 보이고, 범위 없애기는 확인 창을 지나 그 링크 id 로 나간다', async () => {
    const user = userEvent.setup();
    clear.mockResolvedValue({ released: 30 });
    renderEditor({
      divided: true,
      count: 30,
      lastClauses: [{ source: 'system.resid', value: '1-30', op: '' }],
    });
    expect(screen.getByText('나눔 · 30명')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '담당 범위 없애기' }));
    expect(screen.getByText(/다시 설문 전체의 조사 대상을 봅니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '범위 없애기' }));
    await waitFor(() => expect(clear).toHaveBeenCalledWith({ surveyId: SURVEY, linkId: LINK }));
  });
});
