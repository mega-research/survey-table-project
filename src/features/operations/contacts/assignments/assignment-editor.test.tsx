import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssignmentEditor } from './assignment-editor';

const preview = vi.fn();
const apply = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      assignments: {
        preview: (...a: unknown[]) => preview(...a),
        apply: (...a: unknown[]) => apply(...a),
        rename: vi.fn(),
        remove: vi.fn(),
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
const AID = '00000000-0000-4000-8000-0000000000a1';

function renderEditor(
  lastClauses: Array<{ source: string; value: string; op: '' | 'AND' | 'OR' }> | null,
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AssignmentEditor
        surveyId={SURVEY}
        assignment={{ id: AID, name: '10차', lastClauses }}
        columnCandidates={[
          { source: 'system.resid', label: '시스템ID' },
          { source: 'attrs.기업명', label: '기업명' },
        ]}
        resultCodeOptions={[]}
        assignmentOptions={[{ id: AID, name: '10차', order: 1 }]}
        displayColumn={{ source: 'attrs.기업명', label: '기업명' }}
      />
    </QueryClientProvider>,
  );
}

describe('AssignmentEditor — 교체 적용', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue({
      matched: 41,
      current: 59,
      incoming: 10,
      fromOthers: [{ id: 'x', name: '11차', count: 3 }],
      leaving: 31,
    });
  });

  it('마지막 조건으로 채워 열고, 인원이 적히면 적용할 수 있다', async () => {
    renderEditor([
      { source: 'system.resid', value: '1-100', op: '' },
      { source: 'system.resid', value: '짝수', op: 'AND' },
    ]);
    // 디바운스(400ms) 뒤 미리보기 — 전체 스위트 부하에서도 기다리도록 넉넉히.
    expect(await screen.findByText('41명', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '배정 적용' })).toBeEnabled();
    expect(preview).toHaveBeenCalledWith({
      surveyId: SURVEY,
      assignmentId: AID,
      clauses: [
        { source: 'system.resid', value: '1-100', op: '' },
        { source: 'system.resid', value: '짝수', op: 'AND' },
      ],
    });
  });

  it('확인 창에 새로·다른 컨택원에서·빠짐 인원이 보이고 적용하면 같은 조건을 보낸다', async () => {
    const user = userEvent.setup();
    apply.mockResolvedValue({
      matched: 41,
      current: 59,
      incoming: 10,
      fromOthers: [],
      leaving: 31,
    });
    renderEditor([{ source: 'system.resid', value: '1-100', op: '' }]);
    expect(await screen.findByText('41명', undefined, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '배정 적용' }));
    expect(screen.getByText('새로 들어옴 10명 (배정 없음에서)')).toBeInTheDocument();
    expect(screen.getByText('다른 컨택원에서 옮겨 옴 3명 (11차 3)')).toBeInTheDocument();
    expect(screen.getByText('빠짐 31명 (배정 없음이 됩니다)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '배정 적용' }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        surveyId: SURVEY,
        assignmentId: AID,
        clauses: [{ source: 'system.resid', value: '1-100', op: '' }],
      }),
    );
  });

  it('조건이 비어 있으면 적용할 수 없다', async () => {
    renderEditor(null);
    expect(screen.getByText('조건을 하나 이상 넣어야 적용할 수 있습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '배정 적용' })).toBeDisabled();
    expect(preview).not.toHaveBeenCalled();
  });
});

/** 조건 줄의 ID 목록 칸 — 이름 칸(input)과 달리 textarea 다. */
function idListBox(): HTMLTextAreaElement {
  const box = document.querySelector('textarea');
  if (!box) throw new Error('ID 목록 칸이 없다');
  return box;
}

describe('AssignmentEditor — 연속 번호 구간 합치기', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue({ matched: 8, current: 0, incoming: 8, fromOthers: [], leaving: 0 });
  });

  it('낱개로 저장된 옛 조건도 열면 구간으로 합쳐 보인다', async () => {
    renderEditor([{ source: 'system.resid', value: '3 1 2 4 5 9 200 201', op: '' }]);
    expect(idListBox()).toHaveValue('1-5, 9, 200-201');
    expect(await screen.findByText('8명', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({
      surveyId: SURVEY,
      assignmentId: AID,
      clauses: [{ source: 'system.resid', value: '1-5, 9, 200-201', op: '' }],
    });
  });

  it('손으로 적은 낱개 번호는 적용할 때 합쳐 보내고, 칸도 합친 모양으로 바뀐다', async () => {
    const user = userEvent.setup();
    apply.mockResolvedValue({ matched: 8, current: 0, incoming: 8, fromOthers: [], leaving: 0 });
    renderEditor([{ source: 'system.resid', value: '1-2', op: '' }]);
    const box = idListBox();
    await user.clear(box);
    await user.type(box, '7 5 6 1');
    expect(box).toHaveValue('7 5 6 1');
    expect(await screen.findByText('8명', undefined, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '배정 적용' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '배정 적용' }));
    await user.click(screen.getByRole('button', { name: '배정 적용' }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        surveyId: SURVEY,
        assignmentId: AID,
        clauses: [{ source: 'system.resid', value: '1, 5-7', op: '' }],
      }),
    );
    await waitFor(() => expect(box).toHaveValue('1, 5-7'));
  });

  it('명단 열 값 목록에서 고른 여러 값(구분자 형식)은 건드리지 않는다', () => {
    const multi = '\u001f3\u001f1\u001f2\u001f';
    renderEditor([{ source: 'attrs.기업명', value: multi, op: '' }]);
    expect(screen.queryByDisplayValue('1-3')).not.toBeInTheDocument();
  });
});
