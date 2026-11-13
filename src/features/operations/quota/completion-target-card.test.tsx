import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { client } from '@/shared/lib/rpc';

import { CompletionTargetCard } from './completion-target-card';

// 쿼터 설정 화면의 「전체 완료 목표」 카드 — 표시·저장·해제 (CONTEXT.md 「전체 완료 목표」).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/shared/lib/rpc', () => ({
  client: { operations: { control: { setCompletionTarget: vi.fn() } } },
}));

const setCompletionTarget = vi.mocked(client.operations.control.setCompletionTarget);

function renderCard(initialTarget: number | null, completedCount: number) {
  return render(
    <CompletionTargetCard surveyId="s1" initialTarget={initialTarget} completedCount={completedCount} />,
  );
}

const input = () => screen.getByRole('textbox', { name: /전체 완료 목표/ });
const saveButton = () => screen.getByRole('button', { name: '목표 저장' });

describe('CompletionTargetCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('목표가 없으면 「없음」과 현재 완료 수만 보이고 해제 버튼이 없다', () => {
    renderCard(null, 847);

    expect(screen.getByRole('heading', { name: /전체 완료 목표 없음/ })).toBeInTheDocument();
    expect(screen.getByText(/현재 완료 847건/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '해제' })).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('목표가 있으면 남은 수를 보이고, 값을 바꾸기 전에는 저장할 수 없다', () => {
    renderCard(1100, 847);

    expect(screen.getByRole('heading', { name: /전체 완료 목표 1,100건/ })).toBeInTheDocument();
    expect(screen.getByText(/목표까지 253건 남음/)).toBeInTheDocument();
    expect(input()).toHaveValue('1100');
    expect(saveButton()).toBeDisabled();
  });

  it('목표에 닿았으면 응답이 닫혀 있다고 알린다', () => {
    renderCard(1100, 1100);

    expect(screen.getByText(/목표에 도달해 응답이 닫혀 있습니다/)).toBeInTheDocument();
  });

  it('새 목표를 저장하면 그 값으로 RPC 를 부르고 화면이 저장된 값으로 선다', async () => {
    setCompletionTarget.mockResolvedValue({ completionTarget: 1200 });
    renderCard(1100, 847);

    await userEvent.clear(input());
    await userEvent.type(input(), '1,200');
    await userEvent.click(saveButton());

    expect(setCompletionTarget).toHaveBeenCalledWith({ surveyId: 's1', completionTarget: 1200 });
    expect(await screen.findByRole('heading', { name: /전체 완료 목표 1,200건/ })).toBeInTheDocument();
    expect(input()).toHaveValue('1200');
  });

  it('해석할 수 없는 값은 저장을 막고 이유를 보인다', async () => {
    renderCard(null, 10);

    await userEvent.type(input(), '0');

    expect(screen.getByText('1 이상의 정수를 입력하세요.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(setCompletionTarget).not.toHaveBeenCalled();
  });

  it('현재 완료 수 이하로 잡으면 저장 즉시 닫힌다고 미리 알린다 — 저장은 막지 않는다', async () => {
    renderCard(null, 847);

    await userEvent.type(input(), '800');

    expect(
      screen.getByText('현재 완료 수 이하입니다. 저장하는 즉시 응답이 닫힙니다.'),
    ).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('해제하면 null 로 저장하고 「없음」으로 돌아간다', async () => {
    setCompletionTarget.mockResolvedValue({ completionTarget: null });
    renderCard(1100, 847);

    await userEvent.click(screen.getByRole('button', { name: '해제' }));

    expect(setCompletionTarget).toHaveBeenCalledWith({ surveyId: 's1', completionTarget: null });
    expect(await screen.findByRole('heading', { name: /전체 완료 목표 없음/ })).toBeInTheDocument();
    expect(input()).toHaveValue('');
  });
});
