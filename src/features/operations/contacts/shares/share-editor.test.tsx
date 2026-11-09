import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderEditor(link: { divided: boolean; count: number; lastClauses: Array<{ source: string; value: string; op: '' | 'AND' | 'OR' }> | null }) {
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
      fromOthers: [{ linkId: OTHER, name: '프라임', count: 20 }],
      leaving: 0,
    });
  });

  it('나누지 않은 링크는 「설문 전체」로 보이고 범위 없애기 버튼이 없다', () => {
    renderEditor({ divided: false, count: 0, lastClauses: null });
    expect(screen.getByText(/설문 전체 — 아직 나누지 않아/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '담당 범위 없애기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '범위 적용' })).toBeDisabled();
  });

  it('미리보기가 인원과 「프라임 링크에 이미 N명」을 보이고, 확인 창을 지나 같은 조건으로 적용한다', async () => {
    const user = userEvent.setup();
    apply.mockResolvedValue({ matched: 100, current: 0, incoming: 80, fromOthers: [], leaving: 0 });
    renderEditor({
      divided: false,
      count: 0,
      lastClauses: [{ source: 'system.resid', value: '1-100', op: '' }],
    });
    expect(await screen.findByText('100명', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('프라임 링크에 이미 20명')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({
      surveyId: SURVEY,
      linkId: LINK,
      clauses: [{ source: 'system.resid', value: '1-100', op: '' }],
    });

    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    expect(screen.getByText('새로 들어옴 80명 (어느 링크에도 없던 대상)')).toBeInTheDocument();
    expect(screen.getByText('다른 링크에서 가져옴 20명 (프라임 20)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        surveyId: SURVEY,
        linkId: LINK,
        clauses: [{ source: 'system.resid', value: '1-100', op: '' }],
      }),
    );
  });

  it('나눈 링크는 지금 인원을 보이고, 범위 없애기는 확인 창을 지나 그 링크 id 로 나간다', async () => {
    const user = userEvent.setup();
    clear.mockResolvedValue({ released: 30 });
    renderEditor({ divided: true, count: 30, lastClauses: [{ source: 'system.resid', value: '1-30', op: '' }] });
    expect(screen.getByText('나눔 · 30명')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '담당 범위 없애기' }));
    expect(screen.getByText(/다시 설문 전체의 조사 대상을 봅니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '범위 없애기' }));
    await waitFor(() => expect(clear).toHaveBeenCalledWith({ surveyId: SURVEY, linkId: LINK }));
  });
});
