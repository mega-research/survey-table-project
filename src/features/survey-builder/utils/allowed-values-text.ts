/**
 * 숫자 칸 허용값 입력 글 ↔ 저장값(`NumberFormat.allowedValues`) 변환 — 빌더 화면 전용.
 *
 * 저장 모양은 숫자 목록 그대로다(응답 화면의 타이핑 차단이 그 목록을 본다). 빌더에서만
 * 「1900-2026, 9999」처럼 범위를 쓰게 해, 펼쳐 저장하고 다시 열 때 이어진 정수를 범위로 묶어 보인다.
 */
import { parseNumericInput } from '@/utils/numeric-input';

/** 범위 하나가 펼칠 수 있는 최대 값 수 — 넘으면 그 조각은 버린다(오타로 수십만 개가 저장되지 않게) */
const MAX_RANGE_SIZE = 10_000;
const RANGE_PATTERN = /^(-?\d+)\s*[-~]\s*(-?\d+)$/;

export function parseAllowedValuesText(text: string): number[] {
  const values: number[] = [];
  for (const rawPart of text.split(',')) {
    const part = rawPart.trim();
    if (part === '') continue;
    const range = RANGE_PATTERN.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      if (hi - lo + 1 > MAX_RANGE_SIZE) continue;
      for (let n = lo; n <= hi; n += 1) values.push(n);
      continue;
    }
    const n = parseNumericInput(part);
    if (n !== null) values.push(n);
  }
  return [...new Set(values)];
}

export function formatAllowedValuesText(values: readonly number[] | undefined): string {
  if (!values || values.length === 0) return '';
  const sorted = [...new Set(values)].sort((x, y) => x - y);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i]!;
    let j = i;
    while (Number.isInteger(sorted[j]) && sorted[j + 1] === sorted[j]! + 1) j += 1;
    if (j - i >= 2) {
      const end = sorted[j]!;
      parts.push(`${start}${start < 0 || end < 0 ? '~' : '-'}${end}`);
      i = j + 1;
    } else {
      parts.push(String(start));
      i += 1;
    }
  }
  return parts.join(', ');
}
