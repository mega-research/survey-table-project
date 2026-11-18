import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import { surveyGroupKeys } from '@/shared/lib/survey-group-queries';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import { GroupRelocateDialog } from './group-relocate-dialog';

const relocateCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: { surveyGroups: { relocate: (...a: unknown[]) => relocateCall(...a) } },
  },
  orpc: {},
}));

const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

function group(
  id: string,
  name: string,
  parentGroupId: string | null = null,
  foreignTeamName: string | null = null,
): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId, surveyCount: 0, foreignTeamName };
}

/**
 * 시안 G4 의 구조다.
 *
 *   이정운 ─ 2026 ─ 상반기 · 하반기
 *          ─ 2025
 *          ─ 2024
 *   김서연
 *   (협업 그룹) 타 팀 폴더
 */
const GROUPS = [
  group('g-lee', '이정운'),
  group('g-2026', '2026', 'g-lee'),
  group('g-h1', '상반기', 'g-2026'),
  group('g-h2', '하반기', 'g-2026'),
  group('g-2025', '2025', 'g-lee'),
  group('g-2024', '2024', 'g-lee'),
  group('g-kim', '김서연'),
  group('g-foreign', '타 팀 폴더', null, '연구2본부'),
];

function renderDialog(
  target: { id: string; name: string } = { id: 'g-2025', name: '2025' },
  groups: readonly SurveyGroupListItem[] = GROUPS,
) {
  const onClose = vi.fn();
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <GroupRelocateDialog group={target} groups={groups} onClose={onClose} />
    </QueryClientProvider>,
  );
  const rerenderWith = (next: readonly SurveyGroupListItem[]) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <GroupRelocateDialog group={target} groups={next} onClose={onClose} />
      </QueryClientProvider>,
    );
  return { onClose, invalidate, rerenderWith };
}

const radio = (name: RegExp | string) => screen.getByRole('radio', { name });

beforeEach(() => {
  relocateCall.mockReset();
  toastSuccess.mockReset();
});

describe('GroupRelocateDialog — 그룹을 옮길 자리 고르기', () => {
  it('무엇을 옮기는지와 지금 위치를 말하고, 「최상위로」가 맨 위에 있다', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: '「2025」 옮기기' })).toBeInTheDocument();
    expect(screen.getByText(/지금 위치: 이정운 › 2025/)).toBeInTheDocument();
    const radios = within(screen.getByRole('radiogroup', { name: '옮길 자리' })).getAllByRole(
      'radio',
    );
    expect(radios[0]).toHaveAccessibleName('최상위로 옮기기');
  });

  it('자기 자신과 그 하위, 다른 팀의 폴더는 목록에 없다', () => {
    renderDialog({ id: 'g-2026', name: '2026' });

    const names = screen.getAllByRole('radio').map((el) => el.getAttribute('aria-label'));
    expect(names).toEqual([
      '최상위로 옮기기',
      '이정운',
      '이정운 › 2025',
      '이정운 › 2024',
      '김서연',
    ]);
  });

  it('같은 이름의 하위 그룹은 읽어 주는 이름이 경로로 갈린다 — 보이는 글자는 이름 그대로다', () => {
    renderDialog({ id: 'g-etc', name: '기타' }, [
      ...GROUPS,
      group('g-kim-2025', '2025', 'g-kim'),
      group('g-etc', '기타'),
    ]);

    const lee2025 = radio('이정운 › 2025');
    const kim2025 = radio('김서연 › 2025');
    expect(lee2025).not.toBe(kim2025);
    // 최상위 그룹의 이름은 그대로다.
    expect(radio('이정운')).toBeInTheDocument();
    // 줄에 보이는 글자는 바뀌지 않는다.
    expect(lee2025.closest('label')).toHaveTextContent(/^2025$/);
    expect(kim2025.closest('label')).toHaveTextContent(/^2025$/);
  });

  it('지금 부모는 「지금 여기」, 깊이가 넘는 자리는 「3단계를 넘습니다」로 꺼져 있고 이유가 글자로 보인다', () => {
    renderDialog();

    expect(radio('이정운')).toBeDisabled();
    expect(radio('이정운')).toHaveAccessibleDescription('지금 여기');
    for (const name of ['이정운 › 2026 › 상반기', '이정운 › 2026 › 하반기']) {
      expect(radio(name)).toBeDisabled();
      expect(radio(name)).toHaveAccessibleDescription('3단계를 넘습니다');
    }
    expect(screen.getByText('지금 여기')).toBeVisible();
    expect(screen.getAllByText('3단계를 넘습니다')).toHaveLength(2);
    // 갈 수 있는 자리는 켜져 있다.
    for (const name of ['최상위로 옮기기', '이정운 › 2026', '이정운 › 2024', '김서연']) {
      expect(radio(name)).toBeEnabled();
    }
  });

  it('최상위 그룹에게는 「최상위로」가 「지금 여기」다', () => {
    renderDialog({ id: 'g-kim', name: '김서연' });

    expect(radio('최상위로 옮기기')).toBeDisabled();
    expect(radio('최상위로 옮기기')).toHaveAccessibleDescription('지금 여기');
  });

  it('자리를 고르기 전에는 옮길 수 없고, 고르면 그 자리를 아래에 되읽어 준다', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole('button', { name: '옮기기' })).toBeDisabled();
    expect(screen.getByText('옮길 자리를 고르세요')).toBeInTheDocument();

    await user.click(radio('김서연'));
    expect(screen.getByText('「김서연」 아래로 옮깁니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '옮기기' })).toBeEnabled();

    await user.click(radio('최상위로 옮기기'));
    expect(screen.getByText('최상위로 옮깁니다')).toBeInTheDocument();
  });

  it('고른 그룹을 새 상위로 실어 보내고, 그룹 목록과 설문 목록을 새로 고친 뒤 닫는다', async () => {
    const user = userEvent.setup();
    relocateCall.mockResolvedValue({ success: true });
    const { onClose, invalidate } = renderDialog();

    await user.click(radio('김서연'));
    await user.click(screen.getByRole('button', { name: '옮기기' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(relocateCall).toHaveBeenCalledWith({ groupId: 'g-2025', parentGroupId: 'g-kim' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyGroupKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyKeys.lists() });
    expect(toastSuccess).toHaveBeenCalledWith('「2025」 그룹을 「김서연」 아래로 옮겼습니다');
  });

  it('「최상위로」는 새 상위 없이 보낸다', async () => {
    const user = userEvent.setup();
    relocateCall.mockResolvedValue({ success: true });
    const { onClose } = renderDialog();

    await user.click(radio('최상위로 옮기기'));
    await user.click(screen.getByRole('button', { name: '옮기기' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(relocateCall).toHaveBeenCalledWith({ groupId: 'g-2025', parentGroupId: null });
    expect(toastSuccess).toHaveBeenCalledWith('「2025」 그룹을 최상위로 옮겼습니다');
  });

  it('보내는 동안에는 단추가 꺼져 두 번 옮겨지지 않는다', async () => {
    const user = userEvent.setup();
    let finish!: (value: { success: true }) => void;
    relocateCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { onClose } = renderDialog();

    await user.click(radio('김서연'));
    await user.click(screen.getByRole('button', { name: '옮기기' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '옮기기' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: '옮기기' }));
    expect(relocateCall).toHaveBeenCalledTimes(1);

    finish({ success: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('서버가 거부하면 그 문구를 보이고 창을 닫지 않으며, 목록을 다시 불러 지금 구조를 보여 준다', async () => {
    const user = userEvent.setup();
    relocateCall.mockRejectedValue(new Error('이 자리로 옮기면 그룹이 3단계를 넘습니다.'));
    const { onClose, invalidate, rerenderWith } = renderDialog();

    await user.click(radio('이정운 › 2026'));
    await user.click(screen.getByRole('button', { name: '옮기기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 자리로 옮기면 그룹이 3단계를 넘습니다.',
    );
    expect(onClose).not.toHaveBeenCalled();
    // 실패해도 그룹 목록을 다시 읽는다 — 그 사이 다른 사람이 구조를 바꿨을 수 있다.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyGroupKeys.all });

    // 다시 읽은 구조: 누가 2026 을 3단계로 내려 놓았다 — 고른 자리가 꺼지고 선택이 풀린다.
    rerenderWith([
      group('g-lee', '이정운'),
      group('g-2025', '2025', 'g-lee'),
      group('g-kim', '김서연'),
      group('g-x', '부서 공통', 'g-kim'),
      group('g-2026', '2026', 'g-x'),
    ]);
    expect(radio('김서연 › 부서 공통 › 2026')).toBeDisabled();
    expect(radio('김서연 › 부서 공통 › 2026')).toHaveAccessibleDescription('3단계를 넘습니다');
    expect(screen.getByRole('button', { name: '옮기기' })).toBeDisabled();
  });

  it('옮기려는 그룹이 그 사이 사라졌으면 고를 자리 대신 그 사실을 알린다', () => {
    renderDialog({ id: 'g-gone', name: '지워진 그룹' });

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText(/이 그룹을 찾을 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '옮기기' })).toBeDisabled();
  });
});
