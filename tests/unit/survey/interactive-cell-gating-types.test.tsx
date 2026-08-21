import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InteractiveCell } from '@/components/question-renderer/cells/interactive-cell';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { TableCell } from '@/types/survey';

/**
 * 게이팅 인터랙티브 셀 타입 확장 회귀 테스트 — radio/select 셀도 컨트롤러 조건
 * 미충족 시 셀이 통째로 숨겨져야 한다 (2026-08-06 UX 결정: 회색 잠금 → 숨김).
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

  it('radio 셀: 컨트롤러 미충족이면 셀이 렌더되지 않는다 (숨김)', () => {
    const { container } = renderGated(gatedRadio);
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('radio 셀: 컨트롤러 충족(수행)이면 제자리에 나타난다', () => {
    useTestResponseStore.setState({ testResponses: { q1: { ctrl: '1' } } });
    const { container } = renderGated(gatedRadio);
    const input = container.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(false);
  });

  it('select 셀: 컨트롤러 미충족이면 셀이 렌더되지 않는다 (숨김)', () => {
    const { container } = renderGated(gatedSelect);
    expect(container.querySelector('select')).toBeNull();
  });

  it('셀 텍스트(content)가 있으면 컨트롤만 숨고 텍스트는 남는다', () => {
    const withContent: TableCell = { ...gatedRadio, content: '항목 설명 텍스트' };
    const { container } = render(
      <InteractiveCell cell={withContent} questionId="q1" isTestMode rowCells={rowCells} />,
    );
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.textContent).toContain('항목 설명 텍스트');
  });

  it('게이팅 없는 셀은 항상 표시된다', () => {
    const plain: TableCell = { ...gatedRadio, id: 'plain' };
    delete (plain as Partial<TableCell>).enabledWhen;
    const { container } = render(
      <InteractiveCell cell={plain} questionId="q1" isTestMode rowCells={rowCells} />,
    );
    const input = container.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(false);
  });
});
