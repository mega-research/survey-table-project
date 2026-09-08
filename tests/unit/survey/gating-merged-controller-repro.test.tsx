import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * 재현 테스트 — 프로덕션 GQ1-2 구조 그대로:
 * 구분(radio, rowspan=2 앵커) 값이 1~4일 때만 진행상태(radio, rowspan=2 앵커)가 활성.
 * 병합으로 숨겨진 2행 셀에는 잔재 게이팅 사본이 남아 있다 (실데이터 동일).
 * ② 선택 → 진행상태 표시, ⑤ 선택 → 진행상태 숨김이어야 한다.
 */

const CTRL_R0 = 'cell-r0-gubun';
const GATED_R0 = 'cell-r0-status';
const CTRL_R1 = 'cell-r1-gubun';
const GATED_R1 = 'cell-r1-status';

const gubunOptions = [
  { id: 'g1', label: '① 국내특허', value: '1' },
  { id: 'g2', label: '② 국내실용신안', value: '2' },
  { id: 'g3', label: '③ 해외특허(PCT 국제출원 포함)', value: '3' },
  { id: 'g4', label: '④ 해외실용신안', value: '4' },
  { id: 'g5', label: '⑤ SW 저작권 등록', value: '5' },
];

const statusOptions = [
  { id: 's1', label: '① 출원 (미공개)', value: '1' },
  { id: 's2', label: '② 출원공개', value: '2' },
  { id: 's3', label: '③ 등록', value: '3' },
];

const enabledWhen = {
  kind: 'option' as const,
  controllerCellId: CTRL_R0,
  values: ['1', '2', '3', '4'],
};

const columns: TableColumn[] = [
  { id: 'col-0', label: '' },
  { id: 'col-1', label: '지식재산권 명' },
  { id: 'col-2', label: '구분' },
  { id: 'col-3', label: '진행상태' },
  { id: 'col-4', label: '출원·등록기관' },
];

const rows: TableRow[] = [
  {
    id: 'row-0',
    label: '①',
    cells: [
      { id: 'cell-r0-no', type: 'text', content: '①' },
      { id: 'cell-r0-name', type: 'input', content: '' },
      { id: CTRL_R0, type: 'radio', content: '', rowspan: 2, radioOptions: gubunOptions },
      {
        id: GATED_R0,
        type: 'radio',
        content: '',
        rowspan: 2,
        radioOptions: statusOptions,
        enabledWhen,
      },
      { id: 'cell-r0-org', type: 'input', content: '', rowspan: 2 },
    ],
  },
  {
    id: 'row-1',
    label: '②',
    cells: [
      { id: 'cell-r1-no', type: 'text', content: '②' },
      { id: 'cell-r1-name', type: 'input', content: '' },
      { id: CTRL_R1, type: 'radio', content: '', isHidden: true, radioOptions: gubunOptions },
      {
        id: GATED_R1,
        type: 'radio',
        content: '',
        isHidden: true,
        radioOptions: statusOptions,
        enabledWhen,
      },
      { id: 'cell-r1-org', type: 'input', content: '', isHidden: true },
    ],
  },
];

beforeAll(() => {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserver;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});

afterEach(cleanup);

describe('병합 앵커 컨트롤러 게이팅 — GQ1-2 재현', () => {
  beforeEach(() => {
    useTestResponseStore.setState({ testResponses: {} });
  });

  it('② 선택 시 진행상태 표시, ⑤ 선택 시 진행상태 숨김', () => {
    render(
      <InteractiveTableResponse
        questionId="q39"
        columns={columns}
        rows={rows}
        isTestMode
        ignoreDisplayConditions
      />,
    );

    // 초기: 컨트롤러 미응답 = 진행상태 숨김
    expect(screen.queryByLabelText('① 출원 (미공개)')).toBeNull();

    // ② 국내실용신안 선택 → 진행상태 나타남
    fireEvent.click(screen.getByLabelText('② 국내실용신안'));
    expect(screen.queryByLabelText('① 출원 (미공개)')).not.toBeNull();

    // ⑤ SW 저작권 등록 선택 → 진행상태 다시 숨김
    fireEvent.click(screen.getByLabelText('⑤ SW 저작권 등록'));
    expect(screen.queryByLabelText('① 출원 (미공개)')).toBeNull();
  });

  it('⑤를 곧바로 선택해도 진행상태는 숨김 유지', () => {
    render(
      <InteractiveTableResponse
        questionId="q39"
        columns={columns}
        rows={rows}
        isTestMode
        ignoreDisplayConditions
      />,
    );

    fireEvent.click(screen.getByLabelText('⑤ SW 저작권 등록'));
    expect(screen.queryByLabelText('① 출원 (미공개)')).toBeNull();
  });
});
