import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CheckboxCell } from '@/components/survey-builder/cells/checkbox-cell';
import { RadioCell } from '@/components/survey-builder/cells/radio-cell';
import type { TableCell } from '@/types/survey';

// N열 옵션 그리드에서 라디오/체크박스 컨트롤은 라벨이 2줄로 감겨도
// 첫 줄 중앙에 고정되어야 한다 (items-start + mt-1, 질문 레벨 옵션과 동일 컨벤션).
// 그리드 아이템(래퍼)은 행 상단 정렬을 유지해 이웃 옵션의 첫 줄 라인이 서로 맞는다.
function expectControlPinnedToFirstLine(container: HTMLElement, optionCount: number) {
  const grid = container.querySelector('.options-grid');
  expect(grid).toBeTruthy();
  expect(grid!.children.length).toBe(optionCount);

  const inputs = Array.from(container.querySelectorAll('input'));
  expect(inputs.length).toBe(optionCount);
  for (const input of inputs) {
    expect(input.className).toContain('mt-1');
    expect(input.className).toContain('shrink-0');
    expect(input.parentElement!.className).toContain('items-start');
    // 래퍼가 세로 중앙 정렬을 걸면 첫 줄 라인이 이웃과 어긋난다
    expect(input.parentElement!.parentElement!.className).not.toContain('justify-center');
  }
}

describe('테이블 셀 옵션 세로 정렬 (N열 그리드)', () => {
  afterEach(cleanup);

  it('RadioCell 라디오는 라벨 첫 줄 중앙에 고정된다', () => {
    const cell = {
      id: 'cell-radio',
      type: 'radio',
      optionsColumns: 3,
      radioOptions: [
        { id: 'o1', label: '한 줄 옵션', value: '1' },
        { id: 'o2', label: '두 줄로 감기는 아주 긴 옵션 라벨', value: '2' },
        { id: 'o3', label: '세 번째', value: '3' },
      ],
    } as unknown as TableCell;

    const { container } = render(
      <RadioCell cell={cell} cellResponse="" onUpdateValue={() => {}} questionId="q1" />,
    );
    expectControlPinnedToFirstLine(container, 3);
  });

  it('CheckboxCell 체크박스는 라벨 첫 줄 중앙에 고정된다', () => {
    const cell = {
      id: 'cell-check',
      type: 'checkbox',
      optionsColumns: 2,
      checkboxOptions: [
        { id: 'o1', label: '한 줄 옵션', value: '1' },
        { id: 'o2', label: '두 줄로 감기는 아주 긴 옵션 라벨', value: '2' },
      ],
    } as unknown as TableCell;

    const { container } = render(
      <CheckboxCell cell={cell} cellResponse={[]} onUpdateValue={() => {}} questionId="q1" />,
    );
    expectControlPinnedToFirstLine(container, 2);
  });
});
