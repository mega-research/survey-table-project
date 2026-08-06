import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InteractiveCell } from '@/components/survey-builder/cells/interactive-cell';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { TableCell } from '@/types/survey';

/**
 * 게이팅 인터랙티브 셀 타입 확장 회귀 테스트 — radio/select 셀도 컨트롤러 조건
 * 미충족 시 비활성 렌더가 되어야 한다 (기존에는 input 셀만 배선됨).
 * InteractiveCell(테스트 모드, zustand)을 통째로 태워 GATABLE 배선 전체를 검증한다.
 */

const ctrl: TableCell = {
  id: 'ctrl',
  type: 'radio',
  content: '',
  radioOptions: [
    { id: 'o1', label: '수행', value: '1' },
    { id: 'o2', label: '미수행', value: '2' },
  ],
};

const gatedRadio: TableCell = {
  id: 'g-radio',
  type: 'radio',
  content: '',
  radioOptions: [{ id: 'a1', label: '옵션A', value: 'a' }],
  enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
};

const gatedSelect: TableCell = {
  id: 'g-select',
  type: 'select',
  content: '',
  selectOptions: [{ id: 'c1', label: '옵션C', value: 'c' }],
  enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
};

const rowCells = [ctrl, gatedRadio, gatedSelect];

function renderGated(cell: TableCell) {
  return render(
    <InteractiveCell cell={cell} questionId="q1" isTestMode rowCells={rowCells} />,
  );
}

describe('게이팅 셀 타입 확장 — 비활성 렌더 배선', () => {
  beforeEach(() => {
    useTestResponseStore.setState({ testResponses: {} });
  });
  afterEach(cleanup);

  it('radio 셀: 컨트롤러 미충족이면 라디오가 disabled 된다', () => {
    const { container } = renderGated(gatedRadio);
    const input = container.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('radio 셀: 컨트롤러 충족(수행)이면 활성이다', () => {
    useTestResponseStore.setState({ testResponses: { q1: { ctrl: '1' } } });
    const { container } = renderGated(gatedRadio);
    const input = container.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it('select 셀: 컨트롤러 미충족이면 select 가 disabled 된다', () => {
    const { container } = renderGated(gatedSelect);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('게이팅 없는 셀은 항상 활성이다', () => {
    const plain: TableCell = { ...gatedRadio, id: 'plain' };
    delete (plain as Partial<TableCell>).enabledWhen;
    const { container } = render(
      <InteractiveCell cell={plain} questionId="q1" isTestMode rowCells={rowCells} />,
    );
    const input = container.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });
});
