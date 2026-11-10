import { ORPCError } from '@orpc/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import { surveyGroupKeys } from '@/shared/lib/survey-group-queries';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import { GroupDeleteDialog } from './group-delete-dialog';

const removeCall = vi.fn();
const listCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: { surveyGroups: { remove: (...a: unknown[]) => removeCall(...a) } },
  },
  orpc: {
    workspace: { surveyGroups: { list: { call: (...a: unknown[]) => listCall(...a) } } },
  },
}));

const TEAM = '22222222-2222-4222-8222-222222222222';

function group(
  id: string,
  name: string,
  parentGroupId: string | null,
  surveyCount = 0,
): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId, surveyCount, foreignTeamName: null };
}

const LEE = group('lee', '이정운', null, 31);
const Y2026 = group('2026', '2026', 'lee', 18);
const GROUPS = [LEE, Y2026, group('h1', '상반기', '2026', 9), group('h2', '하반기', '2026', 4)];

function renderDialog(target: SurveyGroupListItem) {
  const onClose = vi.fn();
  const queryClient = new QueryClient();
  queryClient.setQueryData(surveyGroupKeys.list(TEAM), GROUPS);
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <GroupDeleteDialog group={target} teamId={TEAM} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, invalidate };
}

beforeEach(() => {
  removeCall.mockReset();
  listCall.mockReset();
  listCall.mockResolvedValue(GROUPS);
});

describe('GroupDeleteDialog — 삭제 확인', () => {
  it('올라갈 자리의 이름을 적고 설문 건수는 적지 않는다', () => {
    renderDialog(Y2026);

    const dialog = screen.getByRole('alertdialog', { name: '「2026」 그룹을 삭제할까요?' });
    expect(dialog).toHaveTextContent(
      '하위 그룹 2개(상반기 · 하반기)와 여기에 직접 담긴 설문이 한 단계 위 「이정운」 그룹으로 올라갑니다. 설문은 삭제되지 않습니다.',
    );
    // 이 그룹의 설문 수(18)도, 하위 그룹의 설문 수(9·4)도 창에 없다.
    expect(dialog).not.toHaveTextContent(/18|9|설문 \d/);
  });

  it('최상위 그룹이면 설문이 미분류로 간다고 적는다', () => {
    renderDialog(LEE);

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      '하위 그룹 1개(2026)는 최상위 그룹이 되고, 여기에 직접 담긴 설문은 미분류로 돌아갑니다.',
    );
  });

  it('「삭제」를 누르면 그 그룹을 지우고 그룹 목록과 설문 목록을 새로 고친 뒤 닫는다', async () => {
    const user = userEvent.setup();
    removeCall.mockResolvedValue({ success: true });
    const { onClose, invalidate } = renderDialog(Y2026);

    await user.click(screen.getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(removeCall).toHaveBeenCalledWith({ groupId: '2026' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyGroupKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyKeys.lists() });
  });

  it('요청 중에는 「삭제」를 다시 누를 수 없다', async () => {
    const user = userEvent.setup();
    let settle!: (value: { success: true }) => void;
    removeCall.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const { onClose } = renderDialog(Y2026);

    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled();
    settle({ success: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(removeCall).toHaveBeenCalledTimes(1);
  });
});

describe('GroupDeleteDialog — 이름이 겹쳐 막혔을 때', () => {
  it('겹치는 이름과 고칠 방법을 알리고, 목록을 새로 고치고, 「확인」으로만 닫는다', async () => {
    const user = userEvent.setup();
    removeCall.mockRejectedValue(
      new ORPCError('CONFLICT', {
        message: '한 단계 위에 이미 「상반기」 그룹이 있어 하위 그룹을 올릴 수 없습니다.',
        data: { conflictingNames: ['상반기'] },
      }),
    );
    const { onClose, invalidate } = renderDialog(Y2026);

    await user.click(screen.getByRole('button', { name: '삭제' }));

    const dialog = await screen.findByRole('alertdialog', {
      name: '「2026」 그룹을 삭제할 수 없습니다',
    });
    expect(dialog).toHaveTextContent(
      '「이정운」에 이미 「상반기」 그룹이 있어 하위 그룹을 올릴 수 없습니다. 둘 중 하나의 이름을 바꾼 뒤 다시 삭제하세요.',
    );
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // 그 사이 다른 팀원이 구조를 바꿨을 수 있다 — 실패해도 지금 구조를 다시 읽는다.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyGroupKeys.all });

    await user.click(screen.getByRole('button', { name: '확인' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('다른 거부는 그 문구를 보이고 창을 닫지 않는다 — 다시 누를 수 있다', async () => {
    const user = userEvent.setup();
    removeCall.mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '그룹을 찾을 수 없습니다.' }),
    );
    const { onClose } = renderDialog(Y2026);

    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('그룹을 찾을 수 없습니다.');
    expect(screen.getByRole('button', { name: '삭제' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
