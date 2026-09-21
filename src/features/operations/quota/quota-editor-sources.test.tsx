import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuotaEditor } from '@/features/operations/quota/quota-editor';
import type { QuotaConfig } from '@/shared/contracts/quota';
import { client } from '@/shared/lib/rpc';
import type { Question } from '@/types/survey';

// 조사 대상 속성형 · 텍스트형 조건의 편집 — 표본 배분(산업 분야 × 성남 여부)이 출처.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: { quota: { save: vi.fn(() => Promise.resolve({})), attrValues: vi.fn() } },
}));

const addressQuestion: Question = {
  id: 'q1',
  type: 'table',
  title: 'Q1. 일반 현황',
  required: true,
  order: 1,
  tableRowsData: [
    {
      id: 'r2',
      label: '(2) 주소',
      cells: [
        { id: 'c-label', type: 'text', content: '(2) 주소' },
        { id: 'c-sido', type: 'input', content: '시/도' },
        { id: 'c-sigungu', type: 'input', content: '시/군/구' },
      ],
    },
    {
      id: 'r3',
      label: '(3) 설립연도',
      cells: [{ id: 'c-year', type: 'input', content: '년', inputType: 'number' }],
    },
  ],
};

const config: QuotaConfig = {
  enabled: false,
  dimensions: [
    {
      id: 'd-field',
      questionId: '',
      label: '산업 분야',
      kind: 'attr',
      attrKey: '산업 분야',
      categories: [{ id: 'c-ai', label: '인공지능', values: ['인공지능'] }],
    },
    {
      id: 'd-region',
      questionId: 'q1',
      label: '지역',
      kind: 'text',
      cellIds: ['c-sido'],
      categories: [
        { id: 'c-sn', label: '성남시', keywords: ['성남'] },
        { id: 'c-etc', label: '성남시 외', isElse: true },
      ],
    },
  ],
  cells: [],
  closedMessage: null,
};

function renderEditor(props: Partial<Parameters<typeof QuotaEditor>[0]> = {}) {
  return render(
    <QuotaEditor
      surveyId="s1"
      initialConfig={config}
      questions={[addressQuestion]}
      attrColumns={[{ key: '산업 분야', label: '산업 분야' }]}
      requireInviteToken
      {...props}
    />,
  );
}

describe('QuotaEditor — 조사 대상 속성형 · 텍스트형', () => {
  beforeEach(() => {
    vi.mocked(client.quota.save).mockClear();
  });

  it('유형 이름과 대상 칸 후보를 보여 준다 — 숫자 칸은 후보가 아니다', () => {
    renderEditor();

    expect(screen.getByText('조사 대상 속성')).toBeInTheDocument();
    expect(screen.getByText('텍스트형')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '(2) 주소 · 시/도' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '(2) 주소 · 시/군/구' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /설립연도/ })).not.toBeInTheDocument();
  });

  it('대상 칸을 더 고르고 키워드를 더해 저장하면 그 모양대로 보낸다', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('checkbox', { name: '(2) 주소 · 시/군/구' }));
    const keywords = screen.getByRole('textbox', { name: '성남시 키워드' });
    await user.clear(keywords);
    await user.type(keywords, '성남, seongnam ,');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(client.quota.save).toHaveBeenCalledOnce();
    const sent = vi.mocked(client.quota.save).mock.calls[0]![0].config;
    const region = sent.dimensions[1]!;
    expect(region.cellIds).toEqual(['c-sido', 'c-sigungu']);
    expect(region.categories[0]!.keywords).toEqual(['성남', 'seongnam']);
    expect(region.categories[1]).toMatchObject({ isElse: true });
  });

  it('「그 외」는 하나뿐이고, 새 카테고리는 그 앞에 들어간다', async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.queryByRole('button', { name: '+ 「그 외」 추가' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ 카테고리 추가' }));
    await user.type(screen.getByRole('textbox', { name: '새 카테고리 키워드' }), '수원');
    await user.click(screen.getByRole('button', { name: '저장' }));

    const sent = vi.mocked(client.quota.save).mock.calls[0]![0].config;
    expect(sent.dimensions[1]!.categories.map((c) => c.isElse ?? false)).toEqual([false, false, true]);
  });

  it('대상 칸을 전부 풀거나 키워드를 비우면 저장하지 않고 알린다', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('checkbox', { name: '(2) 주소 · 시/도' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(client.quota.save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('대상 칸을 하나 이상');
  });

  it('속성형 조건이 있는데 초대 토큰 강제가 꺼져 있으면 경고한다', () => {
    renderEditor({ requireInviteToken: false });
    expect(screen.getByText(/익명 응답은 조사 대상 속성을 알 수 없어/)).toBeInTheDocument();
  });

  it('초대 토큰 강제가 켜져 있으면 경고하지 않는다', () => {
    renderEditor();
    expect(screen.queryByText(/익명 응답은 조사 대상 속성을 알 수 없어/)).not.toBeInTheDocument();
  });

  it('소스가 사라진 조건을 알린다 — 명단에 없는 열, 문항에서 사라진 칸', () => {
    renderEditor({
      attrColumns: [],
      questions: [{ ...addressQuestion, tableRowsData: [] }],
    });
    expect(screen.getByText(/조사 대상 명단에 이 열이 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/대상 칸 일부가 문항에서 사라졌습니다/)).toBeInTheDocument();
  });
});
