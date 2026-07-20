import { describe, expect, it } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';
import { computeStickyLeftColumns } from '@/utils/table-grid-utils';

/**
 * 좌측 sticky 열 자동 판정 회귀 테스트.
 *
 * radio 가 sticky 후보인 것은 "라디오 1개짜리 라벨 셀" 열을 고정하기 위한
 * 의도였는데, 응답용 radio 셀(옵션 여러 개)까지 후보로 인정되면 colspan
 * 점유 열(판정 스킵)과 결합해 고정 범위가 척도 영역까지 번진다 —
 * 태블릿 폭에서 너비 클램프에 걸리면 "3열까지 고정 + 다음 열 깨짐" 증상.
 */

function scaleTable(): { columns: TableColumn[]; rows: TableRow[] } {
  // 항목(150) + 척도 9열(각 60)
  const columns: TableColumn[] = [
    { id: 'c0', label: '항목', width: 150 },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `c${i + 1}`,
      label: i === 0 ? '전혀 도움 안 됨' : i === 8 ? '매우 도움 됨' : '.....',
      width: 60,
    })),
  ];
  const rows: TableRow[] = Array.from({ length: 5 }, (_, r) => ({
    id: `r${r}`,
    label: `${r + 1})`,
    cells: [
      { id: `r${r}c0`, type: 'text', content: `${r + 1}) 항목` },
      {
        id: `r${r}c1`,
        type: 'radio',
        content: '',
        colspan: 9,
        radioOptions: Array.from({ length: 11 }, (_, i) => ({
          id: `r${r}o${i}`,
          label: String(i),
          value: String(i),
        })),
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `r${r}c${i + 2}`,
        type: 'radio' as const,
        content: '',
        isHidden: true,
      })),
    ],
  })) as unknown as TableRow[];
  return { columns, rows };
}

describe('computeStickyLeftColumns', () => {
  it('응답용 radio 셀(옵션 여러 개) 열은 sticky 후보가 아니다 — 라벨 열에서 멈춘다', () => {
    const { columns, rows } = scaleTable();
    // iPad 급 뷰포트 클램프 (768 * 0.6)
    const info = computeStickyLeftColumns(columns, rows, 460);
    expect(info.stickyColCount).toBe(1);
  });

  it('클램프 미측정 시점에도 응답용 radio 열은 후보가 아니다', () => {
    const { columns, rows } = scaleTable();
    const info = computeStickyLeftColumns(columns, rows);
    expect(info.stickyColCount).toBe(1);
  });

  it('라벨 + 응답 colspan 2열 표도 라벨 열이 고정된다 (Part-A 형 표)', () => {
    const columns: TableColumn[] = [
      { id: 'c0', label: '', width: 120 },
      { id: 'c1', label: '', width: 600 },
    ];
    const rows = [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'a', type: 'text', content: '소재지' },
          {
            id: 'b',
            type: 'radio',
            content: '',
            radioOptions: Array.from({ length: 17 }, (_, i) => ({
              id: `o${i}`,
              label: `지역${i}`,
              value: String(i),
            })),
          },
        ],
      },
    ] as unknown as TableRow[];
    expect(computeStickyLeftColumns(columns, rows, 460).stickyColCount).toBe(1);
  });

  it('전 열이 고정 후보면 비활성 — 스크롤 열이 하나도 안 남는 경우', () => {
    const columns: TableColumn[] = [
      { id: 'c0', label: '', width: 100 },
      { id: 'c1', label: '', width: 100 },
    ];
    const rows = [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'a', type: 'text', content: 'ㄱ' },
          { id: 'b', type: 'text', content: 'ㄴ' },
        ],
      },
    ] as unknown as TableRow[];
    expect(computeStickyLeftColumns(columns, rows, 460).stickyColCount).toBe(0);
  });

  it('라디오 1개짜리 라벨 셀 열은 여전히 sticky 후보다 (기존 의도 보존)', () => {
    const columns: TableColumn[] = [
      { id: 'c0', label: '', width: 120 },
      { id: 'c1', label: '', width: 120 },
      { id: 'c2', label: 'A', width: 100 },
      { id: 'c3', label: 'B', width: 100 },
      { id: 'c4', label: 'C', width: 100 },
    ];
    const rows = [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'a', type: 'text', content: '구분' },
          {
            id: 'b',
            type: 'radio',
            content: '',
            radioOptions: [{ id: 'o1', label: '라벨', value: 'v' }],
          },
          { id: 'c', type: 'input', content: '' },
          { id: 'd', type: 'input', content: '' },
          { id: 'e', type: 'input', content: '' },
        ],
      },
    ] as unknown as TableRow[];
    expect(computeStickyLeftColumns(columns, rows, 460).stickyColCount).toBe(2);
  });
});
