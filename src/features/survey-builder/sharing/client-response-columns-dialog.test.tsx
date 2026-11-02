import { ORPCError } from '@orpc/client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientResponseColumnsOutput } from '@/shared/contracts/workspace-io';

const { state, save } = vi.hoisted(() => ({
  state: { data: null as unknown },
  save: vi.fn(),
}));

vi.mock('../queries/use-survey-access-link', () => ({
  useClientResponseColumns: () => ({ data: state.data, isPending: false, isError: false }),
  useSetClientResponseColumns: () => ({ mutateAsync: save, isPending: false }),
}));

import { ClientResponseColumnsDialog } from './client-response-columns-dialog';

const CANDIDATES: ClientResponseColumnsOutput['candidates'] = [
  { key: 'sys.idx', label: '순번', kind: 'sys' },
  { key: 'sys.status', label: '상태', kind: 'sys' },
  { key: 'sys.startedAt', label: '시작일시', kind: 'sys' },
  { key: 'entry.euid', label: 'euid', kind: 'entry' },
];

function columns(keys: string[], version: number): ClientResponseColumnsOutput {
  return { candidates: CANDIDATES, keys, version };
}

/**
 * 「열 설정」 다이얼로그 — 고른 열을 순서대로 저장하고, 남이 먼저 저장했으면 새로 불러온다.
 */
describe('ClientResponseColumnsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = columns(['sys.idx', 'sys.status'], 1);
  });

  it('순번은 뺄 수 없고, 더한 열은 끝에 붙어 불러온 version 과 함께 저장된다', async () => {
    save.mockResolvedValue(columns(['sys.idx', 'sys.status', 'entry.euid'], 2));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ClientResponseColumnsDialog surveyId="s-1" onClose={onClose} />);

    expect(screen.getByRole('checkbox', { name: '순번 빼기' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'euid 더하기' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(save).toHaveBeenCalledWith({
      surveyId: 's-1',
      keys: ['sys.idx', 'sys.status', 'entry.euid'],
      expectedVersion: 1,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('위로 옮기면 순번 다음 자리까지만 간다', async () => {
    state.data = columns(['sys.idx', 'sys.status', 'sys.startedAt'], 1);
    save.mockResolvedValue(columns(['sys.idx', 'sys.startedAt', 'sys.status'], 2));
    const user = userEvent.setup();
    render(<ClientResponseColumnsDialog surveyId="s-1" onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: '상태 위로' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '시작일시 위로' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ keys: ['sys.idx', 'sys.startedAt', 'sys.status'] }),
    );
  });

  it('남이 먼저 저장했으면(CONFLICT) 닫지 않고 알리며, 새로 불러온 설정으로 다시 그린다', async () => {
    save.mockRejectedValue(
      new ORPCError('CONFLICT', { message: '다른 사람이 먼저 열 설정을 바꿨습니다.' }),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ClientResponseColumnsDialog surveyId="s-1" onClose={onClose} />);

    await user.click(screen.getByRole('checkbox', { name: 'euid 더하기' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('다른 사람이 먼저 열 설정을 바꿨습니다.');

    // 무효화가 다시 읽어 온 남의 설정 — 이 화면에서 더했던 euid 는 남지 않는다.
    state.data = columns(['sys.idx', 'sys.startedAt'], 2);
    rerender(<ClientResponseColumnsDialog surveyId="s-1" onClose={onClose} />);

    expect(screen.getByRole('checkbox', { name: '시작일시 빼기' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'euid 더하기' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: '상태 빼기' })).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('그 밖의 실패는 문구를 보이고 편집 중인 값을 지킨다', async () => {
    save.mockRejectedValue(new Error('클라이언트에게 보일 수 없는 열이 들어 있습니다.'));
    const user = userEvent.setup();
    render(<ClientResponseColumnsDialog surveyId="s-1" onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'euid 더하기' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByText('클라이언트에게 보일 수 없는 열이 들어 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'euid 빼기' })).toBeChecked();
  });
});
