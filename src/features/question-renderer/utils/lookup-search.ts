/**
 * 표 입력 칸 「목록에서 찾기」 (TableCell.lookupSearch).
 *
 * 응답자가 글자를 치면 설문 참조표(LUT)에서 표시 열이 그 글자를 품은 행을 후보로 띄우고, 고르면
 * 이 칸에 표시 열 값을, 같은 표의 다른 입력 칸에 지정한 열 값을 한 번에 채운다(기업명 →
 * 법인등록번호·사업자등록번호). 목록에 없는 값도 직접 적을 수 있어 저장되는 것은 평범한 글자다 —
 * 저장·검증·내보내기는 이 기능을 모른다.
 *
 * 순수 규칙만 둔다. 화면은 cells/input-cell 이 그린다.
 */
import type { CellLookupFill, CellLookupSearch, SurveyLookup, TableCell } from '@/types/survey';
import { isInputFormat } from '@/types/input-type';

import { parseInputFormat } from './input-format';
import { cellLockTemplate } from './token-prefill';

/**
 * 후보 개수 상한. 목록은 스크롤되므로 화면이 아니라 그리는 비용을 막는 값이다 — 조사명부(80개사)는
 * 통째로 들어가고, 수천 행짜리 참조표도 글자를 치기 전에 수천 줄을 그리지 않는다.
 */
export const LOOKUP_SEARCH_LIMIT = 100;

export interface ResolvedLookupSearch {
  lookup: SurveyLookup;
  labelColumn: string;
  fills: CellLookupFill[];
}

export interface LookupSearchHit {
  /** 참조표 행 번호 — 고를 때 buildLookupPickPatch 에 넘긴다 */
  index: number;
  label: string;
}

/**
 * 설정을 지금 참조표에 맞춰 푼다. 참조표가 지워졌거나 표시 열이 없으면 null — 그 칸은 평범한
 * 입력칸으로 그린다. 참조표에 없는 열이나 빈 칸 id 를 가리키는 채우기는 버린다.
 */
export function resolveLookupSearch(
  config: CellLookupSearch | undefined,
  lookups: readonly SurveyLookup[],
): ResolvedLookupSearch | null {
  if (!config) return null;
  const lookup = lookups.find((l) => l.id === config.lookupId);
  if (!lookup || !lookup.columns.includes(config.labelColumn)) return null;
  const fills = (config.fills ?? []).filter(
    (fill) => fill.cellId !== '' && lookup.columns.includes(fill.column),
  );
  return { lookup, labelColumn: config.labelColumn, fills };
}

/** 법인 표기 — 응답자는 붙이기도 하고 빼기도 한다. 목록 쪽 표기와 무관하게 찾게 걷는다. */
const CORPORATE_MARKERS = /\(주\)|㈜|주식회사|\(유\)|유한회사|\(재\)|\(사\)/g;

/** 한글 호환 자모 — 조합 중인 끝 글자(「삼ㅅ」)가 검색을 끊지 않게 뺀다. */
const TRAILING_JAMO = /[ㄱ-ㆎ]+$/;

export function normalizeLookupSearchText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(CORPORATE_MARKERS, '')
    .replace(/[\s()·.,\-]/g, '')
    .replace(TRAILING_JAMO, '');
}

function cellText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * 표시 열이 검색어를 품은 행 — 앞이 맞는 행을 먼저, 그다음 참조표 순서. 검색어가 비면(법인 표기만
 * 친 것 포함) 목록 전체를 참조표 순서로 — 선택 상자처럼 훑어 고르는 경우다.
 */
export function searchLookupRows(
  resolved: ResolvedLookupSearch,
  query: string,
  limit: number = LOOKUP_SEARCH_LIMIT,
): LookupSearchHit[] {
  const needle = normalizeLookupSearchText(query);
  const prefix: LookupSearchHit[] = [];
  const contains: LookupSearchHit[] = [];
  resolved.lookup.rows.forEach((row, index) => {
    const label = cellText(row[resolved.labelColumn]);
    if (label === '') return;
    const haystack = normalizeLookupSearchText(label);
    const at = haystack.indexOf(needle);
    if (at < 0) return;
    (at === 0 ? prefix : contains).push({ index, label });
  });
  return [...prefix, ...contains].slice(0, limit);
}

/** 대상 칸의 입력 형식대로 정돈한다. 형식에 맞지 않으면 손대지 않는다 — 검사는 칸이 한다. */
function fillValue(target: TableCell, raw: string): string {
  if (raw === '' || !isInputFormat(target.inputType)) return raw;
  const parsed = parseInputFormat(target.inputType, raw);
  return parsed.ok ? parsed.normalized : raw;
}

/** 채울 수 있는 칸 — 응답자가 보는 입력 칸이고, 명단 값으로 잠긴 칸이 아니다. */
function isFillTarget(cell: TableCell): boolean {
  return cell.type === 'input' && !cell.isHidden && cellLockTemplate(cell) === null;
}

/**
 * 행 하나를 골랐을 때 쓸 값 — 칸 id → 값. 빈 값도 빈 글자로 쓴다(앞서 고른 회사의 번호가 남지
 * 않게). 표에 없는 칸·채울 수 없는 칸·자기 자신은 건너뛴다.
 */
export function buildLookupPickPatch(
  resolved: ResolvedLookupSearch,
  rowIndex: number,
  ownCellId: string,
  tableCells: readonly TableCell[],
): Record<string, string> {
  const row = resolved.lookup.rows[rowIndex];
  if (!row) return {};
  const patch: Record<string, string> = { [ownCellId]: cellText(row[resolved.labelColumn]) };
  const cellsById = new Map(tableCells.map((cell) => [cell.id, cell]));
  for (const fill of resolved.fills) {
    if (fill.cellId === ownCellId) continue;
    const target = cellsById.get(fill.cellId);
    if (!target || !isFillTarget(target)) continue;
    patch[fill.cellId] = fillValue(target, cellText(row[fill.column]));
  }
  return patch;
}
