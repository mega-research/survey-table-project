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

/**
 * 좌측 sticky 열 개수 명시 지정(stickyColumnCount).
 *
 * 미지정(undefined)은 기존 자동 판정 그대로다. 0 은 강제 해제, 1 이상은 정적 셀
 * 경계 판정을 건너뛰고 앞에서 그 개수만큼 고정한다. 다만 "스크롤할 열이 하나도
 * 안 남으면 표가 아니다"·"좁은 화면에서 화면을 다 덮지 않는다" 두 가드는
 * 지정값에도 그대로 걸린다.
 */
describe('computeStickyLeftColumns — 개수 명시 지정', () => {
  /** 열이 서로 독립인 표 — 항목(150) + 입력 9열(각 60). 자동 판정은 항목 열에서 멈춘다. */
  function independentColumnTable(): { columns: TableColumn[]; rows: TableRow[] } {
    const columns: TableColumn[] = [
      { id: 'c0', label: '항목', width: 150 },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `c${i + 1}`, label: `${i + 1}`, width: 60 })),
    ];
    const rows = Array.from({ length: 5 }, (_, r) => ({
      id: `r${r}`,
      label: '',
      cells: [
        { id: `r${r}c0`, type: 'text', content: `${r + 1}) 항목` },
        ...Array.from({ length: 9 }, (_, i) => ({
          id: `r${r}c${i + 1}`,
          type: 'input' as const,
          content: '',
        })),
      ],
    })) as unknown as TableRow[];
    return { columns, rows };
  }

  it('지정값은 정적 셀 경계를 넘어 앞 N열을 고정한다 (자동이면 1열에서 멈추는 표)', () => {
    const { columns, rows } = independentColumnTable();
    // 자동 판정은 입력 셀 열에서 멈춰 1열
    expect(computeStickyLeftColumns(columns, rows, 720).stickyColCount).toBe(1);
    // 지정하면 입력 열까지 포함해 3열 (150 + 60 + 60 = 270 ≤ 720)
    expect(computeStickyLeftColumns(columns, rows, 720, 3).stickyColCount).toBe(3);
  });

  it('0 은 자동이면 고정될 표에서도 고정하지 않는다', () => {
    const { columns, rows } = independentColumnTable();
    expect(computeStickyLeftColumns(columns, rows, 720, 0).stickyColCount).toBe(0);
  });

  it('지정값도 너비 상한에 걸리면 줄어든다 — 최소 1열은 유지', () => {
    const { columns, rows } = independentColumnTable();
    // 상한 200: 첫 열(150)은 무조건, 다음 열을 더하면 210 > 200 이라 중단
    expect(computeStickyLeftColumns(columns, rows, 200, 3).stickyColCount).toBe(1);
  });

  it('응답 셀이 colspan 으로 뒤 열을 통째로 덮는 표는 지정해도 라벨 열까지만 고정된다', () => {
    // 척도 응답이 colspan 9 라 2열 이후는 어디를 끊어도 그 셀 내부다 — 겹침 대신 물러난다
    const { columns, rows } = scaleTable();
    expect(computeStickyLeftColumns(columns, rows, 720, 3).stickyColCount).toBe(1);
  });

  it('지정값이 전체 열 수 이상이면 비활성 — 스크롤할 열이 안 남는다', () => {
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
          { id: 'b', type: 'input', content: '' },
        ],
      },
    ] as unknown as TableRow[];
    expect(computeStickyLeftColumns(columns, rows, 460, 2).stickyColCount).toBe(0);
    expect(computeStickyLeftColumns(columns, rows, 460, 1).stickyColCount).toBe(1);
  });

  it('열이 2개 미만이면 지정해도 비활성', () => {
    const columns: TableColumn[] = [{ id: 'c0', label: '', width: 100 }];
    const rows = [
      { id: 'r1', label: '', cells: [{ id: 'a', type: 'text', content: 'ㄱ' }] },
    ] as unknown as TableRow[];
    expect(computeStickyLeftColumns(columns, rows, 460, 1).stickyColCount).toBe(0);
  });

  it('undefined 는 자동 판정 그대로다', () => {
    const { columns, rows } = scaleTable();
    expect(computeStickyLeftColumns(columns, rows, 720, undefined).stickyColCount).toBe(
      computeStickyLeftColumns(columns, rows, 720).stickyColCount,
    );
  });
});

/**
 * 고정 경계는 colspan 셀 한가운데를 자르지 않는다.
 *
 * 본문 렌더는 `cellIndex < stickyColCount` 로 sticky 를 건다. 경계가 colspan 셀
 * 안쪽을 지나면 그 셀 하나가 sticky 인 채로 여러 열을 가로질러, 스크롤할 때 뒤쪽
 * 열 위를 덮으며 따라온다 — "몇 열만 고정 + 다음 열 겹침" 증상. 자동 판정은
 * 이어지는 셀을 건너뛰므로 스스로는 경계를 만들지 않지만, 너비 컷과 명시 지정은
 * 임의 위치에서 끊으므로 여기서 되돌린다.
 */
describe('computeStickyLeftColumns — colspan 경계 가드', () => {
  function colspanTable(): { columns: TableColumn[]; rows: TableRow[] } {
    // 5열. 1번 셀이 colspan 2 로 1~2열을 덮는다.
    const columns: TableColumn[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      label: `c${i}`,
      width: 100,
    }));
    const rows = [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'a', type: 'text', content: '구분' },
          { id: 'b', type: 'text', content: '묶음', colspan: 2 },
          { id: 'b2', type: 'text', content: '', isHidden: true },
          { id: 'd', type: 'input', content: '' },
          { id: 'e', type: 'input', content: '' },
        ],
      },
    ] as unknown as TableRow[];
    return { columns, rows };
  }

  it('명시 지정이 colspan 안쪽을 자르면 셀 앞까지 물러난다', () => {
    const { columns, rows } = colspanTable();
    // 2 는 colspan 셀(1~2열) 한가운데 → 1 로 물러난다
    expect(computeStickyLeftColumns(columns, rows, 1000, 2).stickyColCount).toBe(1);
    // 3 은 colspan 셀이 통째로 들어가므로 그대로
    expect(computeStickyLeftColumns(columns, rows, 1000, 3).stickyColCount).toBe(3);
  });

  it('너비 컷이 colspan 안쪽을 자르는 경우도 물러난다 (자동 판정 경로)', () => {
    const { columns, rows } = colspanTable();
    // 자동 판정은 3열까지 후보지만 상한 250 이 2열에서 끊는다 → colspan 안쪽 → 1
    expect(computeStickyLeftColumns(columns, rows, 250).stickyColCount).toBe(1);
  });
});
