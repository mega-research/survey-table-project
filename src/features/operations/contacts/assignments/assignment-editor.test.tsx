import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      },
      idLists: { create: vi.fn() },
      attrValues: { nonNumericCount: vi.fn() },
    },
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AssignmentEditor } from './assignment-editor';

const SURVEY = '00000000-0000-4000-8000-000000000001';
const AID = '00000000-0000-4000-8000-0000000000a1';

function renderEditor(lastClauses: Array<{ source: string; value: string; op: '' | 'AND' | 'OR' }> | null) {
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

  it('마지막 조건으로 채워 열고, 인원과 버튼에 결과가 적힌다', async () => {
    renderEditor([
      { source: 'system.resid', value: '1-100', op: '' },
      { source: 'system.resid', value: '짝수', op: 'AND' },
    ]);
    expect(await screen.findByText('41명')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '교체 적용 · 10차 59명 → 41명' })).toBeEnabled();
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
    apply.mockResolvedValue({ matched: 41, current: 59, incoming: 10, fromOthers: [], leaving: 31 });
    renderEditor([{ source: 'system.resid', value: '1-100', op: '' }]);
    await user.click(await screen.findByRole('button', { name: /교체 적용 · 10차/ }));
    expect(screen.getByText('새로 들어옴 10명 (배정 없음에서)')).toBeInTheDocument();
    expect(screen.getByText('다른 컨택원에서 옮겨 옴 3명 (11차 3)')).toBeInTheDocument();
    expect(screen.getByText('빠짐 31명 (배정 없음이 됩니다)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '교체 적용' }));
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
    expect(screen.getByRole('button', { name: '교체 적용' })).toBeDisabled();
    expect(preview).not.toHaveBeenCalled();
  });
});
