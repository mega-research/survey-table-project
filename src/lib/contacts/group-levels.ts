import type { ContactColumnDef, ContactColumnScheme } from '@/db/schema/schema-types';

/**
 * 분류 기준 레벨 슬롯 (진척보고 조합 집계 축).
 * 서버(집계·가드)와 클라이언트(select UI)가 공유하는 순수 모듈 — 'server-only' 금지.
 */

export const GROUP_LEVELS = [1, 2, 3, 4] as const;
export type GroupLevel = (typeof GROUP_LEVELS)[number];

export const GROUP_LEVEL_LABELS: Record<GroupLevel, string> = {
  1: '대분류',
  2: '중분류',
  3: '소분류',
  4: '세부분류',
};

export function isGroupLevel(v: unknown): v is GroupLevel {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/** 진척보고 분류 기준 하나 — 레벨 슬롯에 배정된 attrs 컬럼. */
export interface GroupCriterion {
  /** attrs 키 */
  key: string;
  /** 컬럼 설정의 표시 라벨 (엑셀 헤더 시드) */
  label: string;
  level: GroupLevel;
}

function isAttrsColumn(c: ContactColumnDef): boolean {
  return c.source.startsWith('attrs.') && c.key.length > 0;
}

/**
 * 컬럼 스킴 → 분류 기준 목록 (레벨 오름차순 = 대>중>소>세부 순).
 *
 * - groupLevel 이 하나라도 있으면 그것만 사용 (레벨 중복 시 컬럼 순서 앞쪽이 승리).
 * - 없으면 legacy `groupBy: true` 컬럼들을 컬럼 순서대로 레벨 1..4 로 해석
 *   (토글 방식이던 과거 저장분 호환 — 저장 경로는 groupLevel 만 기록).
 */
export function resolveGroupCriteria(scheme: ContactColumnScheme | null): GroupCriterion[] {
  const attrsCols = (scheme?.columns ?? [])
    .filter(isAttrsColumn)
    .slice()
    .sort((a, b) => a.order - b.order);

  const leveled = attrsCols.filter((c) => isGroupLevel(c.groupLevel));
  if (leveled.length > 0) {
    const byLevel = new Map<GroupLevel, ContactColumnDef>();
    for (const c of leveled) {
      const level = c.groupLevel as GroupLevel;
      if (!byLevel.has(level)) byLevel.set(level, c);
    }
    return GROUP_LEVELS.filter((l) => byLevel.has(l)).map((l) => {
      const c = byLevel.get(l) as ContactColumnDef;
      return { key: c.key, label: c.label, level: l };
    });
  }

  // legacy groupBy 호환 — 컬럼 순서대로 1..4
  return attrsCols
    .filter((c) => c.groupBy === true)
    .slice(0, GROUP_LEVELS.length)
    .map((c, i) => ({ key: c.key, label: c.label, level: GROUP_LEVELS[i] as GroupLevel }));
}
