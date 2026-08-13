/**
 * 컨택 업로드 병합/중복검사용 순수 매칭 로직.
 * 서버(matchPreview·ingest)와 클라(위저드 유사 키 제안)가 공용 — server-only import 금지.
 */

import type { ContactColumnScheme } from '@/db/schema/schema-types';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';

export interface ExistingContactKeyInfo {
  targetId: string;
  attrs: Record<string, string>;
}

export interface RowMatchResult {
  /** 기존 컨택 1건과 정확히 일치한 행 */
  matched: Array<{ rowIndex: number; targetId: string }>;
  /** 일치하는 기존 컨택이 없는 행 */
  unmatched: number[];
  /** 파일 내 같은 키가 2행 이상 — 해당 키의 모든 행 (갱신 대상 모호) */
  fileDuplicates: number[];
  /** 기존 컨택 2건 이상과 일치 — 갱신 대상 모호 */
  multiMatches: number[];
  /** 키 값이 하나라도 빈 행 — 매칭 불가 */
  emptyKeys: number[];
}

export interface EmptyOverwriteStat {
  columnKey: string;
  count: number;
  isPii: boolean;
}

// NUL 문자 분리자 — 한글 포함 모든 텍스트에서 절대 나타나지 않음, 복합키 충돌 방지
const SEP = '\u0000';

/** 키 값들을 trim 후 결합. 하나라도 빈 값이면 null (매칭 불가). */
export function buildKeyTuple(
  row: Record<string, string>,
  mergeKeys: string[],
): string | null {
  const parts: string[] = [];
  for (const key of mergeKeys) {
    const v = (row[key] ?? '').trim();
    if (!v) return null;
    parts.push(v);
  }
  return parts.join(SEP);
}

/**
 * 엑셀 행 전체를 매칭 분류. 우선순위: emptyKey > fileDuplicate > multiMatch > matched/unmatched.
 */
export function classifyRows(
  rows: Array<Record<string, string>>,
  mergeKeys: string[],
  existing: ExistingContactKeyInfo[],
): RowMatchResult {
  // 기존 컨택 키맵 (tuple → targetId 목록)
  const existingByTuple = new Map<string, string[]>();
  for (const e of existing) {
    const tuple = buildKeyTuple(e.attrs, mergeKeys);
    if (tuple == null) continue;
    const list = existingByTuple.get(tuple) ?? [];
    list.push(e.targetId);
    existingByTuple.set(tuple, list);
  }

  // 파일 내 tuple 등장 횟수
  const tupleCount = new Map<string, number>();
  const rowTuples: Array<string | null> = rows.map((row) => buildKeyTuple(row, mergeKeys));
  for (const tuple of rowTuples) {
    if (tuple == null) continue;
    tupleCount.set(tuple, (tupleCount.get(tuple) ?? 0) + 1);
  }

  const result: RowMatchResult = {
    matched: [],
    unmatched: [],
    fileDuplicates: [],
    multiMatches: [],
    emptyKeys: [],
  };

  rowTuples.forEach((tuple, rowIndex) => {
    if (tuple == null) {
      result.emptyKeys.push(rowIndex);
      return;
    }
    if ((tupleCount.get(tuple) ?? 0) > 1) {
      result.fileDuplicates.push(rowIndex);
      return;
    }
    const targets = existingByTuple.get(tuple);
    if (!targets || targets.length === 0) {
      result.unmatched.push(rowIndex);
      return;
    }
    if (targets.length > 1) {
      result.multiMatches.push(rowIndex);
      return;
    }
    const targetId = targets[0];
    if (targetId) result.matched.push({ rowIndex, targetId });
  });

  return result;
}

/**
 * 빈 값 덮어쓰기 경고 집계: 갱신 예정(matched) 행에서
 * "기존 값 있음 + 파일 셀 빈 값" 케이스를 컬럼별로 센다.
 * PII 컬럼은 piiPresenceById(contact_pii 행 존재 여부)로 기존 값을 판단.
 */
export function countEmptyOverwrites(
  rows: Array<Record<string, string>>,
  matched: Array<{ rowIndex: number; targetId: string }>,
  headerKeys: string[],
  existingAttrsById: Map<string, Record<string, string>>,
  piiPresenceById: Map<string, Set<string>>,
  piiKeySet: Set<string>,
): EmptyOverwriteStat[] {
  const counts = new Map<string, number>();
  for (const { rowIndex, targetId } of matched) {
    const row = rows[rowIndex];
    if (!row) continue;
    for (const key of headerKeys) {
      const fileValue = (row[key] ?? '').trim();
      if (fileValue) continue;
      const hasExisting = piiKeySet.has(key)
        ? (piiPresenceById.get(targetId)?.has(key) ?? false)
        : Boolean((existingAttrsById.get(targetId)?.[key] ?? '').trim());
      if (hasExisting) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return headerKeys
    .filter((key) => (counts.get(key) ?? 0) > 0)
    .map((key) => ({ columnKey: key, count: counts.get(key) ?? 0, isPii: piiKeySet.has(key) }));
}

export interface SchemeRouting {
  /** 스킴상 pii.<key> 로 등록된 키 → PII 타입 */
  piiByKey: Record<string, PiiFieldType>;
  /** 스킴상 attrs.<key> 로 등록된 키 */
  knownAttrKeys: Set<string>;
}

/**
 * 기존 컬럼 스킴에서 값 라우팅 정보 추출.
 * 병합/추가 업로드에서 기존 컬럼의 attrs/pii 라우팅은 위저드 입력이 아닌
 * 이 결과를 따른다 (PII 평문 유출 차단 — 스펙 그릴링 결정).
 */
export function getSchemeRouting(scheme: ContactColumnScheme | null): SchemeRouting {
  const piiByKey: Record<string, PiiFieldType> = {};
  const knownAttrKeys = new Set<string>();
  for (const col of scheme?.columns ?? []) {
    if (col.source.startsWith('pii.') && col.piiType) {
      piiByKey[col.key] = col.piiType;
    } else if (col.source.startsWith('attrs.')) {
      knownAttrKeys.add(col.key);
    }
  }
  return { piiByKey, knownAttrKeys };
}

/** 공백 제거 + 소문자 비교로 유사 키 후보 탐색 (2단계 키 선택 경고용) */
export function suggestSimilarKeys(key: string, candidates: string[]): string[] {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const target = norm(key);
  if (!target) return [];
  return candidates.filter((c) => {
    const n = norm(c);
    return n === target || n.includes(target) || target.includes(n);
  });
}
