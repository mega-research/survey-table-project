import fs from 'node:fs';
import path from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MOBILE_EXPLICIT_OPTIONS_CLASS } from '@/features/question-renderer/utils/mobile-card-options';
import type { TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 항목 단위 카드·축 단위 카드 — 칸에 「모바일 보기 열 수」를 명시하면 그 칸을 표식으로 감싼다.
 * globals.css 가 표식 아래의 보기 그리드를 화면 폭과 무관하게 N열로 그린다(`.options-grid` 는 640px 미만에서
 * 1열로 강제되고, 푸는 규칙이 행 단위 카드에만 있어 두 카드에서는 2열을 골라도 1열이었다).
 * 명시하지 않은 칸은 표식이 없어 종전대로 1열이다.
 */

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

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
afterEach(cleanup);

const regions = ['① 서울', '② 부산', '③ 대구', '④ 인천'].map((label, i) => ({
  id: `o${i + 1}`,
  label,
  value: String(i + 1),
}));

const columns: TableColumn[] = [
  { id: 'c1', label: '항목', width: 180 },
  { id: 'c2', label: '응답', width: 600 },
];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '본사 소재지',
    cells: [
      { id: 'region-label', type: 'text', content: '본사 소재지' },
      {
        id: 'region',
        type: 'radio',
        content: '',
        optionsColumns: 8,
        mobileOptionsColumns: 2,
        radioOptions: regions,
      },
    ],
  },
  {
    id: 'r2',
    label: '기업 유형',
    cells: [
      { id: 'kind-label', type: 'text', content: '기업 유형' },
      {
        id: 'kind',
        type: 'radio',
        content: '',
        optionsColumns: 4,
        radioOptions: regions.map((o) => ({ ...o, id: `k-${o.id}` })),
      },
    ],
  },
];

const marked = (container: HTMLElement, cellId: string) =>
  container.querySelector(`[data-cell-id="${cellId}"] .${MOBILE_EXPLICIT_OPTIONS_CLASS}`);

describe.each(['item-cards', 'axis-cards'] as const)('모바일 %s — 보기 열 수 명시 표식', (mode) => {
  it('열 수를 명시한 칸만 표식으로 감싸고, 보기 그리드에는 그 열 수가 실린다', () => {
    const { container } = render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        value={{}}
        onChange={() => {}}
        mobileTableDisplayMode={mode}
      />,
    );
    const wrapper = marked(container, 'region');
    expect(wrapper).not.toBeNull();
    const grid = wrapper!.querySelector<HTMLElement>('.options-grid');
    expect(grid?.style.getPropertyValue('--options-grid-cols')).toBe('repeat(2, minmax(0, 1fr))');
    // 명시하지 않은 칸은 표식이 없다 — 640px 미만에서 종전대로 1열
    expect(container.querySelector('[data-cell-id="kind"]')).not.toBeNull();
    expect(marked(container, 'kind')).toBeNull();
  });
});

describe('globals.css — 표식 아래 보기 그리드 규칙', () => {
  it('표식 클래스에 화면 폭과 무관한 열 수 규칙이 있다', () => {
    const css = fs.readFileSync(path.resolve('src/app/globals.css'), 'utf8');
    expect(css).toMatch(
      new RegExp(
        `\\.${MOBILE_EXPLICIT_OPTIONS_CLASS} \\.options-grid \\{\\s*grid-template-columns: var\\(--options-grid-cols`,
      ),
    );
  });
});
