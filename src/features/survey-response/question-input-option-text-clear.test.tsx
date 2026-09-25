import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionInput } from '@/features/survey-response/question-input';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Question } from '@/types/survey';

/**
 * 기타·상세 기재 입력 후 다른 보기로 바꾸면 입력값이 비워져야 한다 — 순위형과 같은 동작.
 * 단일·복수 선택과 보기 표는 입력값이 사이드카에 따로 살아, 바꿔도 남아 있다가 기타를 다시
 * 고르면 예전 글이 되살아났다(2026-09-17 시스템반도체 설문 A1·A6-5-1 보고).
 */
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => false, useMediaQuery: () => false }));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  useSurveyResponseStore.setState({ optionTexts: {} });
});

function Harness({ q }: { q: Question }) {
  const [value, setValue] = useState<unknown>(undefined);
  return <QuestionInput question={q} value={value} onChange={setValue} />;
}

const texts = (qid: string) => useSurveyResponseStore.getState().optionTexts[qid] ?? {};

describe('단일 선택 — 기타 입력 후 다른 보기로 바꾸기', () => {
  const radio = {
    id: 'qr',
    type: 'radio',
    title: '거래 형태',
    required: false,
    order: 0,
    options: [
      { id: 'o1', label: '일회성', value: '옵션1' },
      { id: 'o2', label: '반복적', value: '옵션2' },
      { id: 'etc', label: '기타', value: '3', allowTextInput: true },
    ],
  } as Question;

  it('다른 보기를 고르면 기타 입력값이 비워지고, 기타를 다시 골라도 빈칸이다', async () => {
    const user = userEvent.setup();
    render(<Harness q={radio} />);

    await user.click(screen.getByRole('radio', { name: '기타' }));
    await user.type(screen.getByRole('textbox'), '공동 개발');
    expect(texts('qr')['etc']).toBe('공동 개발');

    await user.click(screen.getByRole('radio', { name: '일회성' }));
    expect(texts('qr')['etc']).toBe('');

    await user.click(screen.getByRole('radio', { name: '기타' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('기타를 유지한 채로는 입력값이 남는다', async () => {
    const user = userEvent.setup();
    render(<Harness q={radio} />);
    await user.click(screen.getByRole('radio', { name: '기타' }));
    await user.type(screen.getByRole('textbox'), '공동 개발');
    expect(texts('qr')['etc']).toBe('공동 개발');
  });
});

describe('복수 선택 — 기타 체크 해제', () => {
  it('기타를 해제하면 입력값이 비워지고, 다른 보기 체크는 영향이 없다', async () => {
    const checkbox = {
      id: 'qc',
      type: 'checkbox',
      title: '보유',
      required: false,
      order: 0,
      options: [
        { id: 'o1', label: 'TV', value: '1' },
        { id: 'etc', label: '기타', value: '9', allowTextInput: true },
      ],
    } as Question;
    const user = userEvent.setup();
    render(<Harness q={checkbox} />);

    await user.click(screen.getByRole('checkbox', { name: '기타' }));
    await user.type(screen.getByRole('textbox'), '청소기');
    await user.click(screen.getByRole('checkbox', { name: 'TV' }));
    expect(texts('qc')['etc']).toBe('청소기');

    await user.click(screen.getByRole('checkbox', { name: '기타' }));
    expect(texts('qc')['etc']).toBe('');
  });
});

describe('보기 그룹 표(체크박스) — 기타 체크 해제', () => {
  it('기타 보기 셀을 해제하면 그 셀의 상세 기재가 비워진다', async () => {
    const table = {
      id: 'qt',
      type: 'checkbox',
      title: '활용 제품',
      required: false,
      order: 0,
      choiceGroups: [{ id: 'g1', type: 'checkbox', label: '활용 여부', groupKey: 'cb1' }],
      tableColumns: [
        { id: 'c1', label: '제품' },
        { id: 'c2', label: '활용 여부' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [
            { id: 'r1c1', type: 'text', content: '연산' },
            { id: 'r1c2', type: 'choice_opt', content: '', choiceGroupId: 'g1' },
          ],
        },
        {
          id: 'r2',
          label: '',
          cells: [
            { id: 'r2c1', type: 'text', content: '기타' },
            {
              id: 'r2c2',
              type: 'choice_opt',
              content: '',
              choiceGroupId: 'g1',
              allowTextInput: true,
              textInputPlaceholder: '기타 입력',
            },
          ],
        },
      ],
    } as unknown as Question;
    const user = userEvent.setup();
    render(<Harness q={table} />);

    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[1]!);
    await user.type(screen.getByPlaceholderText('기타 입력'), '메모리');
    expect(texts('qt')['r2c2']).toBe('메모리');

    await user.click(boxes[0]!);
    expect(texts('qt')['r2c2']).toBe('메모리');

    await user.click(screen.getAllByRole('checkbox')[1]!);
    expect(texts('qt')['r2c2']).toBe('');
  });
});
