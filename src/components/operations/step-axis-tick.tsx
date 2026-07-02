'use client';

import {
  layoutNextLine,
  measureNaturalWidth,
  prepareWithSegments,
} from '@chenglou/pretext';

/**
 * 운영 콘솔 차트(A5 drop-funnel / A6 page-dwell) 공용 X축 tick.
 *
 * 표기 형식 (2줄, 두 차트 동일):
 *   1행: 페이지 N (page 있을 때만, 회색)
 *   2행: 라벨 (진한색, 슬롯 폭 초과 시 말줄임 — 전체 텍스트는 툴팁 헤더가 담당)
 *
 * recharts CartesianAxis 가 custom tick 에 주입하는 prop:
 *   - x, y: tick 좌표 / payload.value: dataKey 값 / payload.index: 데이터 인덱스
 *   - width: X축 전체 폭 / visibleTicksCount: 표시 중인 tick 수
 *   → 슬롯 폭 = width / visibleTicksCount 로 말줄임 기준 산출.
 */

/** tick 폰트 — SVG fontSize=11, globals.css --font-sans 로드 폰트명과 일치해야 측정이 정확. */
const TICK_FONT = '11px "Wanted Sans Variable"';
const ELLIPSIS = '…';
/** 이웃 tick 라벨과 맞닿지 않도록 슬롯 폭에서 빼는 여유 (양쪽 합). */
const TICK_GAP = 8;

/** 같은 label 이 여러 번 등장할 때 occurrence index 표기용 동그라미 숫자. */
export const OCCURRENCE_GLYPHS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

/**
 * 라벨을 maxWidth(px)에 맞게 말줄임. 넘치면 "…" 을 붙이고,
 * 끝의 occurrence 동그라미 숫자는 중복 라벨 구분자이므로 잘리지 않게 보존한다 ("…①").
 * CJK 는 글자 단위로 줄바꿈 가능하므로 layoutNextLine 첫 줄 = 폭에 맞는 최대 접두어.
 */
function truncateTickLabel(label: string, maxWidth: number): string {
  if (!label || !Number.isFinite(maxWidth) || maxWidth <= 0) return label;
  // pretext 는 canvas 측정 — SSR 방어 (ResponsiveContainer 특성상 실제로는 클라이언트에서만 그림).
  if (typeof document === 'undefined') return label;

  const prepared = prepareWithSegments(label, TICK_FONT);
  if (measureNaturalWidth(prepared) <= maxWidth) return label;

  const lastChar = label.slice(-1);
  const suffix = OCCURRENCE_GLYPHS.includes(lastChar) ? lastChar : '';
  const base = suffix ? label.slice(0, -1).trimEnd() : label;
  const tail = `${ELLIPSIS}${suffix}`;
  const tailWidth = measureNaturalWidth(prepareWithSegments(tail, TICK_FONT));

  const line = layoutNextLine(
    suffix ? prepareWithSegments(base, TICK_FONT) : prepared,
    { segmentIndex: 0, graphemeIndex: 0 },
    Math.max(0, maxWidth - tailWidth),
  );
  return `${(line?.text ?? '').trimEnd()}${tail}`;
}

export interface StepTickItem {
  /** 페이지 번호 — null 이면 1행 생략 (기타 / legacy 막대). */
  page: number | null;
  /** 좌측 정렬용 패딩 슬롯 여부 — true 면 tick 을 그리지 않는다. */
  hidden: boolean;
}

interface StepAxisTickProps {
  x?: number;
  y?: number;
  width?: number;
  visibleTicksCount?: number;
  payload?: { value?: string | number; index?: number };
  items: StepTickItem[];
}

export function StepAxisTick({
  x = 0,
  y = 0,
  width,
  visibleTicksCount,
  payload,
  items,
}: StepAxisTickProps) {
  const idx = payload?.index ?? 0;
  const item = items[idx];
  if (!item || item.hidden) {
    return null;
  }

  const slotWidth =
    width && visibleTicksCount && visibleTicksCount > 0
      ? width / visibleTicksCount
      : Number.POSITIVE_INFINITY;
  const label = truncateTickLabel(
    String(payload?.value ?? ''),
    slotWidth - TICK_GAP,
  );
  const pageText = item.page != null ? `페이지 ${item.page}` : '';

  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11}>
      {pageText && (
        <tspan x={x} dy={12} fill="#94a3b8">
          {pageText}
        </tspan>
      )}
      {/* 페이지 행이 없어도 라벨 baseline 을 2행에 고정해 이웃 tick 과 정렬 유지 */}
      <tspan x={x} dy={pageText ? 12 : 24} fill="#475569">
        {label}
      </tspan>
    </text>
  );
}
