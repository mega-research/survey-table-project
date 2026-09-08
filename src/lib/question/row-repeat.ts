/**
 * 표 문항 행 반복 — 구조 펼치기 순수 로직.
 *
 * 응답자가 `+` 로 늘리는 행은 응답 중에 만들어지지 않는다. 빌더가 반복 블록을 켜는
 * 순간 구조에 maxRepeats 벌까지 실제로 펼쳐 두고, 응답 화면은 값에서 파생한 만큼만
 * 노출한다. 그래야 응답값 키가 발행 스냅샷 안의 cell.id 로 유지되어 저장 경계·초안·
 * 이월 임포트·관리자 편집·내보내기가 전부 무변경이다.
 *
 * **펼치기는 멱등이어야 한다.** 저장할 때마다 다시 펼쳐 셀 id 를 재발번하면 이미
 * 수집된 응답의 키가 끊긴다. 그래서 이미 존재하는 벌은 재사용하고, 없는 벌만 만든다.
 *
 * rowCode 를 명시 발번하는 이유는 buildTableCellVarName 의 제로패딩 자릿수가
 * rows.length 기준이기 때문이다 — 반복 블록을 켜서 20벌로 펼치는 순간 같은 표의
 * 비반복 행 변수명이 r1 에서 r01 로 통째 바뀐다. 펼치기 이전 행 수로 계산한 코드를
 * 행에 박아 그 길이 의존을 끊는다 (설계 결정 3).
 */
import type { CalcExpr, Question, RowRepeatConfig, TableCell, TableRow } from '@/types/survey';
import { generateId } from '@/lib/utils';
import { isCellValuePresent } from '@/utils/table-cell-semantics';

/** 최대 반복 벌 수 상한. 구조에 실제로 펼쳐지는 행이라 무한대는 없다. */
export const ROW_REPEAT_MAX = 20;
/** 기본 최대 벌 수 */
export const DEFAULT_ROW_REPEAT_MAX = 20;
/** 추가 버튼 기본 문구 */
export const DEFAULT_ROW_REPEAT_ADD_LABEL = '행 추가';

/** 벌 번호 표시용 원문자 ①..⑳ (라벨 접미에 쓴다) */
const CIRCLED_NUMBERS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
];

/** 반복 행의 rowCode 접미 `_NN` — 재펼치기 때 밑동을 되찾는 데 쓴다(누적 방지). */
const BUNDLE_CODE_SUFFIX = /_\d{2}$/;

/** 복제 벌에 실어 나르지 않는 셀 필드 — 그대로 복제하면 변수명이 중복된다. */
type ClonedAwayCellField =
  | 'cellCode'
  | 'isCustomCellCode'
  | 'exportLabel'
  | 'isCustomExportLabel'
  | 'rankVarNames';

export function clampMaxRepeats(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_ROW_REPEAT_MAX;
  return Math.min(ROW_REPEAT_MAX, Math.max(1, Math.trunc(value as number)));
}

/** 이 행이 몇 번째 벌인지 — 반복 행이 아니면 undefined */
export function repeatIndexOf(row: TableRow): number | undefined {
  return typeof row.repeatIndex === 'number' && row.repeatIndex >= 1 ? row.repeatIndex : undefined;
}

/**
 * 펼치기 이전 모습 — 2벌 이후를 걷어낸 행 목록.
 * 멱등성의 축이다: 이미 펼쳐진 배열을 다시 넣어도 여기서 원래 모습으로 돌아온다.
 */
export function collapseRepeatRows(rows: TableRow[]): TableRow[] {
  return rows.filter((row) => (row.repeatIndex ?? 1) <= 1);
}

/**
 * 구조가 설정과 아직 맞는가 — 지정된 템플릿 행이 전부 살아 있고 서로 붙어 있는가.
 *
 * 설정은 행 id 로 템플릿을 가리키는데 편집 화면은 그 행을 지우거나 옮길 수 있다.
 * 낡은 설정으로 펼치면 남은 벌이 주인 없이 떠돌거나 반복 단위가 조용히 바뀐다.
 */
export function isRowRepeatIntact(
  rows: TableRow[],
  config: RowRepeatConfig | null | undefined,
): boolean {
  if (!isRowRepeatActive(config)) return true;
  const collapsed = collapseRepeatRows(rows);
  const indices: number[] = [];
  for (const id of config!.templateRowIds) {
    const index = collapsed.findIndex((row) => row.id === id);
    if (index === -1) return false;
    indices.push(index);
  }
  indices.sort((a, b) => a - b);
  return indices.every((index, i) => i === 0 || index === indices[i - 1]! + 1);
}

/**
 * 반복 끄기 — 2벌 이후를 걷어내고 1벌을 반복 이전 모습으로 되돌린다.
 *
 * 표식만 남겨 두면 다음에 다시 켤 때 `_01` 로 끝나는 rowCode 를 밑동 삼아 `_01_01` 이
 * 생기고, 남은 `repeatIndex` 때문에 편집 표가 행을 계속 감춘다. 되돌릴 정보가 아직
 * 살아 있는 이 시점에 원래 코드까지 복구한다.
 */
export function disableRowRepeat(rows: TableRow[]): TableRow[] {
  if (!rows.some((row) => repeatIndexOf(row) !== undefined)) return rows;
  return collapseRepeatRows(rows).map((row) => {
    if (repeatIndexOf(row) === undefined) return row;
    const { repeatIndex: _index, repeatSourceRowId: _source, ...rest } = row;
    const base = row.rowCode?.replace(BUNDLE_CODE_SUFFIX, '');
    return base ? { ...rest, rowCode: base } : rest;
  });
}

/** 반복 설정이 실제로 켜져 있고 템플릿이 지정돼 있는가 */
export function isRowRepeatActive(config: RowRepeatConfig | null | undefined): boolean {
  return Boolean(config?.enabled && (config?.templateRowIds?.length ?? 0) > 0);
}

function bundleLabel(templateLabel: string, bundle: number): string {
  const marker = CIRCLED_NUMBERS[bundle - 1] ?? String(bundle);
  const base = (templateLabel ?? '').trim();
  return base.length > 0 ? `${base} ${marker}` : marker;
}

function baseRowCodeOf(row: TableRow, fallback: string): string {
  const raw = row.rowCode?.trim();
  if (!raw) return fallback;
  // 이미 펼쳐진 1벌 행은 rowCode 가 `<밑동>_01` 이다 — 밑동을 되찾아 누적을 막는다.
  if (repeatIndexOf(row) !== undefined) {
    const stripped = raw.replace(BUNDLE_CODE_SUFFIX, '');
    return stripped.length > 0 ? stripped : fallback;
  }
  return raw;
}

/**
 * 수식 안의 셀 참조를 이 벌의 셀로 옮긴다. 블록 밖(맵에 없는 id)과 다른 질문 참조는
 * 그대로 둔다 — 모든 벌이 같은 바깥 값에 매이는 것이 옳다.
 */
function remapCalcExpr(expr: CalcExpr, idMap: ReadonlyMap<string, string>): CalcExpr {
  switch (expr.kind) {
    case 'cell': {
      if (expr.questionId) return expr;
      const mapped = idMap.get(expr.cellId);
      return mapped ? { ...expr, cellId: mapped } : expr;
    }
    case 'agg': {
      const items = expr.items.map((item) => remapCalcExpr(item, idMap));
      return items.every((item, i) => item === expr.items[i]) ? expr : { ...expr, items };
    }
    case 'group': {
      const terms = expr.terms.map((term) => remapCalcExpr(term, idMap));
      return terms.every((term, i) => term === expr.terms[i]) ? expr : { ...expr, terms };
    }
    default:
      return expr;
  }
}

/**
 * 복제 셀이 품고 있는 **블록 안** 셀 참조를 자기 벌의 셀로 옮긴다.
 *
 * 게이팅(enabledWhen)과 검증 수식(formula)은 셀 id 로 다른 셀을 가리킨다. 얕게 복사하면
 * 2벌 셀이 1벌 셀을 보고 열리고 닫히고 검증된다. 블록 밖을 가리키는 참조는 손대지 않는다.
 */
function remapCellRefs(cell: TableCell, idMap: ReadonlyMap<string, string>): TableCell {
  let next = cell;

  if (cell.enabledWhen) {
    const mapped = idMap.get(cell.enabledWhen.controllerCellId);
    if (mapped) {
      next = { ...next, enabledWhen: { ...cell.enabledWhen, controllerCellId: mapped } };
    }
  }

  if (cell.formula) {
    const formula = remapCalcExpr(cell.formula, idMap);
    if (formula !== cell.formula) next = { ...next, formula };
  }

  // 계산 셀은 블록 안에 놓을 수 없지만(검증이 막는다) 구조가 먼저 깨진 데이터에서도
  // 참조가 남의 벌을 가리키지는 않게 둔다.
  if (cell.calcValidation) {
    const target = remapCalcExpr(cell.calcValidation.target, idMap);
    if (target !== cell.calcValidation.target) {
      next = { ...next, calcValidation: { ...cell.calcValidation, target } };
    }
  }

  return next;
}

function cloneCellForBundle(
  template: TableCell,
  newId: string,
  idMap: ReadonlyMap<string, string>,
): TableCell {
  const rest: Omit<TableCell, ClonedAwayCellField> & Partial<Pick<TableCell, ClonedAwayCellField>> =
    { ...template };
  delete rest.cellCode;
  delete rest.isCustomCellCode;
  delete rest.exportLabel;
  delete rest.isCustomExportLabel;
  delete rest.rankVarNames;
  return remapCellRefs({ ...(rest as TableCell), id: newId }, idMap);
}

/**
 * 한 벌의 행·셀 id 를 먼저 전부 정한다. 참조 리맵이 "블록 안"을 판정하려면 그 벌의
 * 대응표가 통째로 있어야 하므로, id 발번과 행 생성을 두 단계로 나눈다.
 */
function assignBundleIds(
  templates: TableRow[],
  bundle: number,
  existingBundles: ReadonlyMap<string, TableRow>,
  makeId: () => string,
): { rowIds: Map<string, string>; cellIds: Map<string, string> } {
  const rowIds = new Map<string, string>();
  const cellIds = new Map<string, string>();
  for (const template of templates) {
    const existing = existingBundles.get(`${template.id}#${bundle}`);
    rowIds.set(template.id, existing?.id ?? makeId());
    template.cells.forEach((cell, index) => {
      cellIds.set(cell.id, existing?.cells[index]?.id ?? makeId());
    });
  }
  return { rowIds, cellIds };
}

/**
 * 템플릿 묶음을 maxRepeats 벌까지 펼친다.
 *
 * - 이미 있는 벌(`repeatSourceRowId` + `repeatIndex` 로 식별)은 **재사용**한다 — 행 id 도
 *   셀 id 도 그대로 두고 템플릿의 구조 변경만 덮어쓴다.
 * - 없는 벌만 새로 만들고 그때만 id 를 발번한다.
 * - maxRepeats 를 줄이면 뒤쪽 벌이 잘린다 (빌더가 경고를 띄운 뒤 부르는 경로).
 * - 설정이 꺼져 있으면 원본 배열을 **참조 그대로** 돌려준다 — 반복을 쓰지 않는 표의
 *   rowCode 를 건드리면 그 표의 기존 변수명이 바뀐다.
 */
export function expandRepeatRows(
  rows: TableRow[],
  config: RowRepeatConfig | null | undefined,
  makeId: () => string = generateId,
): TableRow[] {
  if (!isRowRepeatActive(config)) return rows;
  const templateIds = config!.templateRowIds;
  const maxRepeats = clampMaxRepeats(config!.maxRepeats);

  // 구조가 설정과 어긋났으면(템플릿 행이 지워졌거나 흩어졌으면) 펼치지 않고 되돌린다.
  // 남은 일부로 펼치면 주인 없는 벌이 떠돌거나 반복 단위가 조용히 바뀐다.
  if (!isRowRepeatIntact(rows, config)) return disableRowRepeat(rows);

  const collapsed = collapseRepeatRows(rows);
  const templateIdSet = new Set(templateIds);
  const templates = collapsed.filter((row) => templateIdSet.has(row.id));
  if (templates.length === 0) return disableRowRepeat(rows);

  // 기존 복제 벌 색인 — `<원본 행 id>#<벌 번호>`
  const existingBundles = new Map<string, TableRow>();
  for (const row of rows) {
    const idx = repeatIndexOf(row);
    if (idx !== undefined && idx >= 2 && row.repeatSourceRowId) {
      existingBundles.set(`${row.repeatSourceRowId}#${idx}`, row);
    }
  }

  // rowCode 밑동 — 펼치기 이전 행 수 기준 패딩 (buildTableCellVarName 과 같은 규칙)
  const pad = collapsed.length >= 100 ? 3 : collapsed.length >= 10 ? 2 : 1;
  const baseCodes = new Map<string, string>();
  collapsed.forEach((row, index) => {
    baseCodes.set(row.id, baseRowCodeOf(row, `r${String(index + 1).padStart(pad, '0')}`));
  });

  const firstTemplateId = templates[0]!.id;
  const out: TableRow[] = [];

  for (const row of collapsed) {
    if (templateIdSet.has(row.id)) {
      // 블록은 첫 템플릿 행 자리에서 통째로 펼친다 (나머지 템플릿 행은 그 안에서 나온다)
      if (row.id !== firstTemplateId) continue;
      for (let bundle = 1; bundle <= maxRepeats; bundle++) {
        if (bundle === 1) {
          // 1벌은 템플릿 행 자신 — 셀도 라벨도 참조도 사람이 쓴 그대로 둔다
          for (const template of templates) {
            out.push({
              ...template,
              rowCode: `${baseCodes.get(template.id)!}_01`,
              repeatIndex: 1,
              repeatSourceRowId: template.id,
            });
          }
          continue;
        }
        const { rowIds, cellIds } = assignBundleIds(templates, bundle, existingBundles, makeId);
        for (const template of templates) {
          out.push({
            ...template,
            id: rowIds.get(template.id)!,
            rowCode: `${baseCodes.get(template.id)!}_${String(bundle).padStart(2, '0')}`,
            label: bundleLabel(template.label, bundle),
            repeatIndex: bundle,
            repeatSourceRowId: template.id,
            cells: template.cells.map((cell) =>
              cloneCellForBundle(cell, cellIds.get(cell.id)!, cellIds),
            ),
          });
        }
      }
      continue;
    }
    const code = baseCodes.get(row.id)!;
    out.push(row.rowCode === code ? row : { ...row, rowCode: code });
  }

  return out;
}

// ── 응답 화면 가시성 ──────────────────────────────────────────────

/** 구조에 실제로 펼쳐진 벌 수 (반복 행이 없으면 0) */
export function structuralRepeatCount(rows: TableRow[]): number {
  let max = 0;
  for (const row of rows) {
    const idx = repeatIndexOf(row);
    if (idx !== undefined && idx > max) max = idx;
  }
  return max;
}

/**
 * 값에서 파생하는 열린 벌 수 — `max(1, 값이 들어 있는 마지막 벌)`.
 *
 * 열린 벌 수는 저장하지 않는다. `__dynamicRowSelections__` 같은 루트 사이드카를 쓰면
 * response-sidecars 등록부에 없는 키라 저장 경계에서 거부된다(AGENTS.md 주의사항 13).
 * 파생하면 저장할 것이 없어 그 함정을 아예 밟지 않는다. 대가는 빈 벌을 열어둔 채
 * 이탈했다 돌아오면 그 벌이 접혀 있다는 것뿐이다 — 값 손실은 없다.
 */
export function deriveOpenRepeatCount(
  rows: TableRow[],
  values: Record<string, unknown> | undefined,
): number {
  const cellValues = values ?? {};
  let open = 1;
  for (const row of rows) {
    const idx = repeatIndexOf(row);
    if (idx === undefined || idx <= open) continue;
    if (row.cells.some((cell) => isCellValuePresent(cellValues[cell.id]))) open = idx;
  }
  return open;
}

/** 열린 벌보다 뒤에 있는 반복 행 id — 렌더 파이프라인이 이 집합을 빼고 그린다. */
export function hiddenRepeatRowIds(rows: TableRow[], openCount: number): Set<string> {
  const hidden = new Set<string>();
  for (const row of rows) {
    const idx = repeatIndexOf(row);
    if (idx !== undefined && idx > openCount) hidden.add(row.id);
  }
  return hidden;
}

/** 접을 때 비울 셀 — 지정한 벌보다 뒤에 있는 모든 반복 행의 셀 */
export function cellIdsOfBundlesBeyond(rows: TableRow[], openCount: number): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const idx = repeatIndexOf(row);
    if (idx !== undefined && idx > openCount) {
      for (const cell of row.cells) ids.push(cell.id);
    }
  }
  return ids;
}

// ── 반복 블록 지정 가능성 검증 ────────────────────────────────────

export type RowRepeatViolationKind =
  | 'empty'
  | 'unknown-row'
  | 'not-contiguous'
  | 'cell-type'
  | 'sum-constraint'
  | 'validation-rule'
  | 'display-condition'
  | 'dynamic-row'
  | 'already-expanded';

export interface RowRepeatViolation {
  kind: RowRepeatViolationKind;
  message: string;
  /** 문제가 된 행 id (해당되는 경우) */
  rowIds?: string[];
}

/** 반복 블록 안에 놓아도 되는 셀 종류 — 입력 셀과 라벨용 표시 셀뿐이다. */
const REPEATABLE_CELL_TYPES = new Set<TableCell['type']>(['input', 'text']);

/**
 * 반복 블록으로 지정해도 되는 묶음인지 검사한다. 빌더가 지정을 막는 데 쓰고,
 * 펼치기 함수는 이 판정을 신뢰한다(검증 실패 상태를 조용히 뭉개지 않는다).
 *
 * 선택·계산·랭킹 셀, 합계 제약·분기 규칙·행 표시 조건이 참조하는 행, 동적 행 그룹 소속
 * 행은 벌마다 의미가 갈려 규칙이 얽히므로 지정 대상에서 뺀다 (스펙 제외 목록).
 */
export function validateRowRepeatTemplate(
  question: Pick<Question, 'tableRowsData' | 'sumConstraints' | 'tableValidationRules'>,
  templateRowIds: string[],
): RowRepeatViolation[] {
  const violations: RowRepeatViolation[] = [];
  if (templateRowIds.length === 0) {
    return [{ kind: 'empty', message: '반복할 행을 하나 이상 지정해야 합니다.' }];
  }

  const rows = question.tableRowsData ?? [];
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  const unknown = templateRowIds.filter((id) => !indexById.has(id));
  if (unknown.length > 0) {
    violations.push({
      kind: 'unknown-row',
      message: '표에 없는 행이 지정되었습니다.',
      rowIds: unknown,
    });
    return violations;
  }

  const indices = templateRowIds.map((id) => indexById.get(id)!).sort((a, b) => a - b);
  const contiguous = indices.every((idx, i) => i === 0 || idx === indices[i - 1]! + 1);
  if (!contiguous) {
    violations.push({
      kind: 'not-contiguous',
      message: '반복 단위는 붙어 있는 행 묶음이어야 합니다.',
      rowIds: templateRowIds,
    });
    return violations;
  }

  const blockRows = indices.map((idx) => rows[idx]!);
  const blockRowIds = new Set(blockRows.map((row) => row.id));
  const blockCellIds = new Set(blockRows.flatMap((row) => row.cells.map((cell) => cell.id)));

  const badCellRows = blockRows.filter((row) =>
    row.cells.some((cell) => !REPEATABLE_CELL_TYPES.has(cell.type)),
  );
  if (badCellRows.length > 0) {
    violations.push({
      kind: 'cell-type',
      message: '반복 블록에는 입력 셀과 표시용 텍스트 셀만 넣을 수 있습니다.',
      rowIds: badCellRows.map((row) => row.id),
    });
  }

  const sumRefs = (question.sumConstraints ?? []).filter((constraint) =>
    constraint.cellIds.some((id) => blockCellIds.has(id)),
  );
  if (sumRefs.length > 0) {
    violations.push({
      kind: 'sum-constraint',
      message: '합계 제약이 참조하는 행은 반복 블록으로 지정할 수 없습니다.',
      rowIds: badRowIdsOf(blockRows, blockCellIds, sumRefs.flatMap((c) => c.cellIds)),
    });
  }

  const ruleRefs = (question.tableValidationRules ?? []).filter((rule) => {
    const ids = [...(rule.conditions?.rowIds ?? []), ...(rule.additionalConditions?.rowIds ?? [])];
    return ids.some((id) => blockRowIds.has(id));
  });
  if (ruleRefs.length > 0) {
    violations.push({
      kind: 'validation-rule',
      message: '분기 규칙이 참조하는 행은 반복 블록으로 지정할 수 없습니다.',
    });
  }

  const conditionRows = blockRows.filter((row) => row.displayCondition);
  if (conditionRows.length > 0) {
    violations.push({
      kind: 'display-condition',
      message: '표시 조건이 걸린 행은 반복 블록으로 지정할 수 없습니다.',
      rowIds: conditionRows.map((row) => row.id),
    });
  }

  const dynamicRows = blockRows.filter(
    (row) => row.dynamicGroupId || row.showWhenDynamicGroupId,
  );
  if (dynamicRows.length > 0) {
    violations.push({
      kind: 'dynamic-row',
      message: '동적 행 그룹에 속한 행은 반복 블록으로 지정할 수 없습니다.',
      rowIds: dynamicRows.map((row) => row.id),
    });
  }

  const expandedRows = blockRows.filter((row) => (row.repeatIndex ?? 1) >= 2);
  if (expandedRows.length > 0) {
    violations.push({
      kind: 'already-expanded',
      message: '이미 펼쳐진 반복 행은 다시 템플릿으로 지정할 수 없습니다.',
      rowIds: expandedRows.map((row) => row.id),
    });
  }

  return violations;
}

/** 참조된 셀 id 목록에서 블록 안 행 id 를 되짚는다 (경고에 행을 짚어 주기 위해). */
function badRowIdsOf(
  blockRows: TableRow[],
  blockCellIds: Set<string>,
  referencedCellIds: string[],
): string[] {
  const hit = new Set(referencedCellIds.filter((id) => blockCellIds.has(id)));
  return blockRows
    .filter((row) => row.cells.some((cell) => hit.has(cell.id)))
    .map((row) => row.id);
}
