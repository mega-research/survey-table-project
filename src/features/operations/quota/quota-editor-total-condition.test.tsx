import type { ReactNode } from 'react';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuotaEditor } from '@/features/operations/quota/quota-editor';
import type { QuotaConfig } from '@/shared/contracts/quota';
import { client } from '@/shared/lib/rpc';
import type { Question } from '@/types/survey';

// 쿼터 「완료」 조건 — 설문 전체 완료 수(완료 + 실사 완료 처리)에 거는 조건의 편집 (CONTEXT.md 「완료 조건」).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: { quota: { save: vi.fn(() => Promise.resolve({})), attrValues: vi.fn() } },
}));

// 「+ 조건 추가」는 Radix Select 라 jsdom 에서 열리지 않는다 — 고르는 동작만 보려고 native select 로 바꾼다.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select aria-label="조건 추가" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">+ 조건 추가</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const save = vi.mocked(client.quota.save);

const genderQuestion: Question = {
  id: 'q-gender',
  type: 'radio',
  title: '성별',
  required: false,
  order: 1,
  options: [
    { id: 'opt-male', label: '남성', value: 'male' },
    { id: 'opt-female', label: '여성', value: 'female' },
  ],
};

const empty: QuotaConfig = { enabled: true, dimensions: [], cells: [], closedMessage: null };
const withGender: QuotaConfig = {
  enabled: true,
  dimensions: [
    {
      id: 'dim-gender',
      questionId: genderQuestion.id,
      label: genderQuestion.title,
      kind: 'choice',
      categories: [{ id: 'cat-male', label: '남성', values: ['male'] }],
    },
  ],
  cells: [{ categoryIds: ['cat-male'], target: 10 }],
  closedMessage: null,
};

function renderEditor(initialConfig: QuotaConfig) {
  return render(
    <QuotaEditor surveyId="s1" initialConfig={initialConfig} questions={[genderQuestion]} />,
  );
}

const targetInput = () => screen.getByRole('textbox', { name: '목표' });
const savedConfig = () => save.mock.calls[0]![0].config;

describe('QuotaEditor — 「완료」 조건', () => {
  beforeEach(() => vi.clearAllMocks());

  it('「조건 추가」에서 완료를 고르면 목표 칸 하나짜리 조건 카드가 생긴다', async () => {
    const user = userEvent.setup();
    renderEditor(empty);

    expect(screen.queryByRole('textbox', { name: '목표' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: '조건 추가' }), 'total:');

    expect(targetInput()).toHaveValue('');
    expect(screen.getByText('설문 전체')).toBeInTheDocument();
    // 한 설문에 하나뿐인 조건이다 — 추가한 뒤에는 목록에서 빠진다.
    expect(
      within(screen.getByRole('combobox', { name: '조건 추가' })).queryByRole('option', {
        name: /완료 \(완료 \+ 실사 완료 처리\)/,
      }),
    ).not.toBeInTheDocument();
  });

  it('목표를 적고 저장하면 플랜에 totalTarget 으로 실린다 — 다른 조건과 같은 저장 버튼', async () => {
    const user = userEvent.setup();
    renderEditor(empty);

    await user.selectOptions(screen.getByRole('combobox', { name: '조건 추가' }), 'total:');
    await user.type(targetInput(), '1,100');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(savedConfig()).toMatchObject({ enabled: true, totalTarget: 1100 });
  });

  it('저장된 완료 조건은 다시 열면 목표가 채워져 있고 조건 보기에도 나온다', () => {
    renderEditor({ ...empty, totalTarget: 1100 });

    expect(targetInput()).toHaveValue('1100');
    expect(screen.getByText('1,100건')).toBeInTheDocument();
    expect(screen.queryByText('조건을 먼저 추가하세요.')).not.toBeInTheDocument();
  });

  it('목표가 비었거나 해석할 수 없으면 저장하지 않고 이유를 알린다', async () => {
    const user = userEvent.setup();
    renderEditor({ ...empty, totalTarget: 1100 });

    await user.clear(targetInput());
    await user.type(targetInput(), '0');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      '「완료」 조건의 목표를 1 이상의 정수로 입력해 주세요.',
    );
  });

  it('조건을 지우고 저장하면 totalTarget 을 null 로 지운다', async () => {
    const user = userEvent.setup();
    renderEditor({ ...empty, totalTarget: 1100 });

    // 조건 카드가 하나뿐이라 「조건 삭제」도 하나다.
    await user.click(screen.getByRole('button', { name: '조건 삭제' }));
    expect(screen.queryByRole('textbox', { name: '목표' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(savedConfig()).toHaveProperty('totalTarget', null);
  });

  it('완료 조건을 더하거나 지워도 다른 조건의 셀 목표는 그대로다 — 셀 조합과 무관한 조건이다', async () => {
    const user = userEvent.setup();
    renderEditor(withGender);

    await user.selectOptions(screen.getByRole('combobox', { name: '조건 추가' }), 'total:');
    await user.type(targetInput(), '50');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(savedConfig()).toMatchObject({
      totalTarget: 50,
      cells: [{ categoryIds: ['cat-male'], target: 10 }],
    });
  });

  it('완료 조건을 쓴 적 없는 플랜의 저장 페이로드에는 키를 만들지 않는다', async () => {
    const user = userEvent.setup();
    renderEditor(withGender);

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(savedConfig()).not.toHaveProperty('totalTarget');
  });
});
