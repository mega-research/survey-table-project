/**
 * 옵션 value 를 사용자가 직접 입력한 optionCode(응답값)로 통일하는 일괄 마이그레이션의 순수 로직.
 *
 * 빌더 런타임(`@/utils/option-code-generator` 의 applyCustomOptionCode)은 코드 입력 시점에
 * value 를 동기화하지만, 그 이전에 저장된 데이터는 value !== optionCode 상태로 남아 있다.
 * 이 모듈은 그 기존 데이터를 스캔·변환하는 순수 함수 모음이며 DB 접근을 하지 않는다.
 * 실제 트랜잭션/리포트는 `scripts/migrate-option-value-code.ts` 가 담당한다.
 *
 * ── 대상 판별 규칙 (중요) ──
 * `isCustomOptionCode === true` 인 옵션만 대상이다. "optionCode 필드가 DB 에 있으면 커스텀"
 * 이라는 가정은 이 DB 에서 성립하지 않는다 — stripOptionCodes 가 적용되지 않은 경로로 저장된
 * 자동 발번 코드가 다량 남아 있고(특히 표 셀 옵션), 그 코드는 배열 내 위치 기반이라
 * value 에 묶으면 옵션 순서만 바뀌어도 응답 키가 흔들린다. 따라서 사용자가 직접 입력했다는
 * 명시 표식이 있는 옵션만 변환하고, 나머지는 excludedNonCustom 으로 세어 리포트에만 남긴다.
 */

/** 마이그레이션이 다루는 옵션의 최소 형태 — DB JSONB 원본을 그대로 받는다 */
export type MigratableOption = Record<string, unknown>;

export interface OptionValueChange {
  optionId: string | null;
  label: string;
  oldValue: string;
  newValue: string;
}

export interface SkippedOptionCode {
  optionId: string | null;
  label: string;
  value: string;
  optionCode: string;
  /** collision: 새 value 가 같은 배열의 다른 옵션 value/optionCode 와 충돌 — 강행하지 않고 스킵 */
  reason: 'collision';
}

export interface OptionArrayPlan {
  /** 변환 결과 배열. 변경이 없으면 입력 배열 참조를 그대로 돌려준다 */
  options: MigratableOption[];
  changed: boolean;
  changes: OptionValueChange[];
  skipped: SkippedOptionCode[];
  /** optionCode 는 있으나 커스텀 표식이 없어 제외한 옵션 수 (자동 발번 추정) */
  excludedNonCustom: number;
}

export type ValueMap = ReadonlyMap<string, string>;

const EMPTY_PLAN: OptionArrayPlan = Object.freeze({
  options: Object.freeze([]) as unknown as MigratableOption[],
  changed: false,
  changes: Object.freeze([]) as unknown as OptionValueChange[],
  skipped: Object.freeze([]) as unknown as SkippedOptionCode[],
  excludedNonCustom: 0,
});

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── 1. 옵션 배열 변환 계획 ──

/**
 * 옵션 배열 하나에 대한 value ← optionCode 동기화 계획을 세운다.
 *
 * 충돌 판정은 빌더 런타임(applyCustomOptionCode)과 동일 기준이다 — 같은 배열의 다른 옵션이
 * 그 코드를 value 로 쓰고 있거나 optionCode 로 예약해 두었으면 스킵한다. 여기에 더해 한 번의
 * 패스에서 두 후보가 같은 코드를 노리는 경우도 뒤쪽을 스킵한다.
 */
export function planOptionArrayMigration(input: unknown): OptionArrayPlan {
  if (!Array.isArray(input)) return EMPTY_PLAN;

  const options = input as MigratableOption[];
  const changes: OptionValueChange[] = [];
  const skipped: SkippedOptionCode[] = [];
  const claimed = new Set<string>();
  const next = [...options];
  let excludedNonCustom = 0;
  let changed = false;

  options.forEach((option, index) => {
    if (!isPlainObject(option)) return;

    const value = asString(option['value']);
    const code = asString(option['optionCode']);
    if (value === null || code === null || code === '') return;
    if (code === value) return; // 이미 정합 — no-op

    if (option['isCustomOptionCode'] !== true) {
      excludedNonCustom += 1;
      return;
    }

    const collides =
      claimed.has(code) ||
      options.some(
        (other, i) =>
          i !== index &&
          isPlainObject(other) &&
          (other['optionCode'] === code || other['value'] === code),
      );

    if (collides) {
      skipped.push({
        optionId: asString(option['id']),
        label: asString(option['label']) ?? '',
        value,
        optionCode: code,
        reason: 'collision',
      });
      return;
    }

    claimed.add(code);
    next[index] = { ...option, value: code };
    changed = true;
    changes.push({
      optionId: asString(option['id']),
      label: asString(option['label']) ?? '',
      oldValue: value,
      newValue: code,
    });
  });

  return {
    options: changed ? next : options,
    changed,
    changes,
    skipped,
    excludedNonCustom,
  };
}

/** 변경 목록을 old→new 룩업 맵으로 만든다 (동시 적용용 — 순차 체이닝 금지) */
export function buildValueMap(changes: readonly OptionValueChange[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const change of changes) map.set(change.oldValue, change.newValue);
  return map;
}

/** 여러 맵을 합친다. 같은 old 가 서로 다른 new 로 갈리면 해당 키를 버리고 conflicts 에 기록 */
export function mergeValueMaps(maps: Iterable<ValueMap>): { map: Map<string, string>; conflicts: string[] } {
  const map = new Map<string, string>();
  const conflicts = new Set<string>();

  for (const source of maps) {
    for (const [oldValue, newValue] of source) {
      const existing = map.get(oldValue);
      if (existing !== undefined && existing !== newValue) {
        conflicts.add(oldValue);
        continue;
      }
      map.set(oldValue, newValue);
    }
  }

  for (const key of conflicts) map.delete(key);
  return { map, conflicts: [...conflicts] };
}

// ── 2. 질문 단위 옵션 스캔/적용 ──

export type CellOptionField = 'radioOptions' | 'checkboxOptions' | 'selectOptions' | 'rankingOptions';

export const CELL_OPTION_FIELDS: readonly CellOptionField[] = [
  'radioOptions',
  'checkboxOptions',
  'selectOptions',
  'rankingOptions',
];

/** DB 질문 행에서 이 마이그레이션이 읽는 컬럼만 추린 형태 */
export interface QuestionOptionSource {
  id: string;
  options: unknown;
  selectLevels: unknown;
  rankingConfig: unknown;
  tableRowsData: unknown;
}

export interface CellOptionPlan {
  rowIndex: number;
  cellIndex: number;
  cellId: string;
  field: CellOptionField;
  plan: OptionArrayPlan;
}

export interface QuestionOptionPlan {
  questionId: string;
  /** questions.options */
  questionLevel: OptionArrayPlan;
  /** questions.select_levels[].options */
  selectLevels: Array<{ index: number; plan: OptionArrayPlan }>;
  /** questions.ranking_config.options (스키마상 없지만 레거시 JSONB 방어) */
  rankingConfig: OptionArrayPlan;
  /** questions.table_rows_data[].cells[].{radio,checkbox,select,ranking}Options */
  cells: CellOptionPlan[];
}

/** 질문 하나의 옵션 배열 6종을 모두 스캔해 변환 계획을 세운다 */
export function planQuestionOptions(source: QuestionOptionSource): QuestionOptionPlan {
  const selectLevels: Array<{ index: number; plan: OptionArrayPlan }> = [];
  if (Array.isArray(source.selectLevels)) {
    source.selectLevels.forEach((level, index) => {
      if (!isPlainObject(level)) return;
      selectLevels.push({ index, plan: planOptionArrayMigration(level['options']) });
    });
  }

  const rankingConfig = isPlainObject(source.rankingConfig)
    ? planOptionArrayMigration(source.rankingConfig['options'])
    : EMPTY_PLAN;

  const cells: CellOptionPlan[] = [];
  if (Array.isArray(source.tableRowsData)) {
    source.tableRowsData.forEach((row, rowIndex) => {
      if (!isPlainObject(row) || !Array.isArray(row['cells'])) return;
      (row['cells'] as unknown[]).forEach((cell, cellIndex) => {
        if (!isPlainObject(cell)) return;
        const cellId = asString(cell['id']);
        if (cellId === null) return;
        for (const field of CELL_OPTION_FIELDS) {
          if (!Array.isArray(cell[field])) continue;
          const plan = planOptionArrayMigration(cell[field]);
          cells.push({ rowIndex, cellIndex, cellId, field, plan });
        }
      });
    });
  }

  return {
    questionId: source.id,
    questionLevel: planOptionArrayMigration(source.options),
    selectLevels,
    rankingConfig,
    cells,
  };
}

/** 계획의 모든 변경/스킵/제외를 합산 */
export function summarizeQuestionPlan(plan: QuestionOptionPlan): {
  changes: OptionValueChange[];
  skipped: SkippedOptionCode[];
  excludedNonCustom: number;
  changed: boolean;
} {
  const all: OptionArrayPlan[] = [
    plan.questionLevel,
    plan.rankingConfig,
    ...plan.selectLevels.map((entry) => entry.plan),
    ...plan.cells.map((entry) => entry.plan),
  ];
  return {
    changes: all.flatMap((p) => p.changes),
    skipped: all.flatMap((p) => p.skipped),
    excludedNonCustom: all.reduce((sum, p) => sum + p.excludedNonCustom, 0),
    changed: all.some((p) => p.changed),
  };
}

/** 질문 레벨(options + selectLevels + rankingConfig) 변경분을 하나의 value map 으로 합친다 */
export function buildQuestionValueMap(plan: QuestionOptionPlan): Map<string, string> {
  return mergeValueMaps([
    buildValueMap(plan.questionLevel.changes),
    buildValueMap(plan.rankingConfig.changes),
    ...plan.selectLevels.map((entry) => buildValueMap(entry.plan.changes)),
  ]).map;
}

/** cellId → value map (같은 셀의 옵션 필드 여러 개는 합침) */
export function buildCellValueMaps(plan: QuestionOptionPlan): Map<string, Map<string, string>> {
  const byCell = new Map<string, Map<string, string>>();
  for (const entry of plan.cells) {
    if (entry.plan.changes.length === 0) continue;
    const existing = byCell.get(entry.cellId);
    const merged = mergeValueMaps([existing ?? new Map(), buildValueMap(entry.plan.changes)]).map;
    byCell.set(entry.cellId, merged);
  }
  return byCell;
}

export interface AppliedQuestionOptions {
  options: unknown;
  selectLevels: unknown;
  rankingConfig: unknown;
  tableRowsData: unknown;
  changed: boolean;
}

/** 변환 계획을 질문 JSONB 에 적용한다 (불변 — 변경이 없는 가지는 원본 참조 유지) */
export function applyQuestionOptionPlan(
  source: QuestionOptionSource,
  plan: QuestionOptionPlan,
): AppliedQuestionOptions {
  let changed = false;

  let options = source.options;
  if (plan.questionLevel.changed) {
    options = plan.questionLevel.options;
    changed = true;
  }

  let selectLevels = source.selectLevels;
  const changedLevels = plan.selectLevels.filter((entry) => entry.plan.changed);
  if (changedLevels.length > 0 && Array.isArray(selectLevels)) {
    const nextLevels = [...(selectLevels as unknown[])];
    for (const entry of changedLevels) {
      const level = nextLevels[entry.index];
      if (!isPlainObject(level)) continue;
      nextLevels[entry.index] = { ...level, options: entry.plan.options };
    }
    selectLevels = nextLevels;
    changed = true;
  }

  let rankingConfig = source.rankingConfig;
  if (plan.rankingConfig.changed && isPlainObject(rankingConfig)) {
    rankingConfig = { ...rankingConfig, options: plan.rankingConfig.options };
    changed = true;
  }

  let tableRowsData = source.tableRowsData;
  const changedCells = plan.cells.filter((entry) => entry.plan.changed);
  if (changedCells.length > 0 && Array.isArray(tableRowsData)) {
    const nextRows = [...(tableRowsData as unknown[])];
    for (const entry of changedCells) {
      const row = nextRows[entry.rowIndex];
      if (!isPlainObject(row) || !Array.isArray(row['cells'])) continue;
      const nextCells = [...(row['cells'] as unknown[])];
      const cell = nextCells[entry.cellIndex];
      if (!isPlainObject(cell)) continue;
      nextCells[entry.cellIndex] = { ...cell, [entry.field]: entry.plan.options };
      nextRows[entry.rowIndex] = { ...row, cells: nextCells };
    }
    tableRowsData = nextRows;
    changed = true;
  }

  return { options, selectLevels, rankingConfig, tableRowsData, changed };
}

// ── 3. 참조 리매핑 (표시조건 · 셀 게이팅) ──

export interface ConditionRemapMaps {
  /** sourceQuestionId → 질문 레벨 옵션 value map (requiredValues 용) */
  byQuestion: ReadonlyMap<string, ValueMap>;
  /** sourceQuestionId → 그 질문 셀 옵션 map 합집합 (table-cell 조건의 expectedValues 용) */
  byQuestionCells: ReadonlyMap<string, ValueMap>;
}

function remapStringArray(input: unknown, map: ValueMap | undefined): { value: unknown; count: number } {
  if (!map || map.size === 0 || !Array.isArray(input)) return { value: input, count: 0 };

  let count = 0;
  const next = input.map((item) => {
    if (typeof item !== 'string') return item;
    const mapped = map.get(item);
    if (mapped === undefined) return item;
    count += 1;
    return mapped;
  });
  return count > 0 ? { value: next, count } : { value: input, count: 0 };
}

/**
 * 표시조건 그룹(questions/question_groups/행/열 공용)의 값 참조를 리매핑한다.
 * requiredValues 는 질문 레벨 맵, tableConditions/additionalConditions 의 expectedValues 는
 * 해당 질문의 셀 맵 합집합을 쓴다.
 */
export function remapConditionGroup(group: unknown, maps: ConditionRemapMaps): { value: unknown; count: number } {
  if (!isPlainObject(group) || !Array.isArray(group['conditions'])) return { value: group, count: 0 };

  let total = 0;
  const nextConditions = (group['conditions'] as unknown[]).map((condition) => {
    if (!isPlainObject(condition)) return condition;
    const sourceId = asString(condition['sourceQuestionId']);
    if (sourceId === null) return condition;

    const questionMap = maps.byQuestion.get(sourceId);
    const cellMap = maps.byQuestionCells.get(sourceId);
    let next = condition;
    let changed = false;

    const required = remapStringArray(condition['requiredValues'], questionMap);
    if (required.count > 0) {
      next = { ...next, requiredValues: required.value };
      changed = true;
      total += required.count;
    }

    const tableConditions = condition['tableConditions'];
    if (isPlainObject(tableConditions)) {
      const expected = remapStringArray(tableConditions['expectedValues'], cellMap);
      if (expected.count > 0) {
        next = { ...next, tableConditions: { ...tableConditions, expectedValues: expected.value } };
        changed = true;
        total += expected.count;
      }
    }

    const additional = condition['additionalConditions'];
    if (isPlainObject(additional)) {
      const expected = remapStringArray(additional['expectedValues'], cellMap);
      if (expected.count > 0) {
        next = { ...next, additionalConditions: { ...additional, expectedValues: expected.value } };
        changed = true;
        total += expected.count;
      }
    }

    return changed ? next : condition;
  });

  return total > 0 ? { value: { ...group, conditions: nextConditions }, count: total } : { value: group, count: 0 };
}

/**
 * conditionType 'expression' 조건이 변환 후보 질문을 참조하는지 센다.
 *
 * expression 조건은 `expressionConfig.clauses[].comparison` 의 literal 피연산자에 옵션 value 가
 * 들어갈 수 있는데, 그 literal 이 어느 질문의 값 공간인지 구조적으로 알 수 없어 안전한 자동
 * 리매핑이 불가능하다. 따라서 이 마이그레이션은 expression 을 건드리지 않고, 후보 질문을
 * 참조하는 expression 조건이 있으면 리포트에 노출해 사람이 판단하게 한다 (0 이면 무영향).
 */
export function countExpressionExposure(
  group: unknown,
  candidateQuestionIds: ReadonlySet<string>,
): { total: number; exposed: number } {
  if (!isPlainObject(group) || !Array.isArray(group['conditions'])) return { total: 0, exposed: 0 };

  let total = 0;
  let exposed = 0;

  for (const condition of group['conditions'] as unknown[]) {
    if (!isPlainObject(condition) || condition['conditionType'] !== 'expression') continue;
    total += 1;

    const referenced = new Set<string>();
    const sourceId = asString(condition['sourceQuestionId']);
    if (sourceId !== null) referenced.add(sourceId);
    collectExpressionQuestionRefs(condition['expressionConfig'], referenced);

    for (const questionId of referenced) {
      if (candidateQuestionIds.has(questionId)) {
        exposed += 1;
        break;
      }
    }
  }

  return { total, exposed };
}

/** expression operand 트리에서 질문 참조(kind 'question' | 'cell')를 모은다 */
function collectExpressionQuestionRefs(config: unknown, into: Set<string>): void {
  if (!isPlainObject(config) || !Array.isArray(config['clauses'])) return;

  const walkOperand = (operand: unknown): void => {
    if (!isPlainObject(operand)) return;
    const kind = operand['kind'];
    if (kind === 'question' || kind === 'cell') {
      const questionId = asString(operand['questionId']);
      if (questionId !== null) into.add(questionId);
      return;
    }
    if (kind === 'binop') {
      walkOperand(operand['left']);
      walkOperand(operand['right']);
    }
  };

  for (const clause of config['clauses'] as unknown[]) {
    if (!isPlainObject(clause)) continue;
    if (clause['kind'] === 'comparison' && isPlainObject(clause['comparison'])) {
      walkOperand(clause['comparison']['left']);
      walkOperand(clause['comparison']['right']);
      continue;
    }
    if (clause['kind'] === 'group') collectExpressionQuestionRefs(clause['group'], into);
  }
}

/** table_columns[].displayCondition 리매핑 */
export function remapTableColumns(columns: unknown, maps: ConditionRemapMaps): { value: unknown; count: number } {
  if (!Array.isArray(columns)) return { value: columns, count: 0 };

  let total = 0;
  const next = columns.map((column) => {
    if (!isPlainObject(column) || column['displayCondition'] === undefined) return column;
    const remapped = remapConditionGroup(column['displayCondition'], maps);
    if (remapped.count === 0) return column;
    total += remapped.count;
    return { ...column, displayCondition: remapped.value };
  });

  return total > 0 ? { value: next, count: total } : { value: columns, count: 0 };
}

/**
 * table_rows_data 의 행 표시조건 + 셀 게이팅(enabledWhen)을 리매핑한다.
 * 게이팅은 kind === 'option' 이고 controllerCellId 의 맵이 있는 경우에만 values 를 치환한다.
 */
export function remapTableRows(
  rows: unknown,
  maps: ConditionRemapMaps,
  cellMaps: ReadonlyMap<string, ValueMap>,
): { value: unknown; conditionCount: number; gatingCount: number } {
  if (!Array.isArray(rows)) return { value: rows, conditionCount: 0, gatingCount: 0 };

  let conditionCount = 0;
  let gatingCount = 0;

  const nextRows = rows.map((row) => {
    if (!isPlainObject(row)) return row;
    let nextRow = row;
    let rowChanged = false;

    if (row['displayCondition'] !== undefined) {
      const remapped = remapConditionGroup(row['displayCondition'], maps);
      if (remapped.count > 0) {
        nextRow = { ...nextRow, displayCondition: remapped.value };
        rowChanged = true;
        conditionCount += remapped.count;
      }
    }

    if (Array.isArray(row['cells'])) {
      let cellsChanged = false;
      const nextCells = (row['cells'] as unknown[]).map((cell) => {
        if (!isPlainObject(cell)) return cell;
        const enabledWhen = cell['enabledWhen'];
        if (!isPlainObject(enabledWhen) || enabledWhen['kind'] !== 'option') return cell;
        const controllerCellId = asString(enabledWhen['controllerCellId']);
        if (controllerCellId === null) return cell;
        const remapped = remapStringArray(enabledWhen['values'], cellMaps.get(controllerCellId));
        if (remapped.count === 0) return cell;
        gatingCount += remapped.count;
        cellsChanged = true;
        return { ...cell, enabledWhen: { ...enabledWhen, values: remapped.value } };
      });
      if (cellsChanged) {
        nextRow = { ...nextRow, cells: nextCells };
        rowChanged = true;
      }
    }

    return rowChanged ? nextRow : row;
  });

  const total = conditionCount + gatingCount;
  return total > 0
    ? { value: nextRows, conditionCount, gatingCount }
    : { value: rows, conditionCount: 0, gatingCount: 0 };
}

// ── 4. 응답 값 리매핑 ──

export interface QuestionResponseSpec {
  /** 질문 레벨 옵션 value map (radio/select/checkbox/ranking/multiselect) */
  questionMap: ValueMap | null;
  /** cellId → value map (table 질문의 choice 셀만) */
  cellMaps: ReadonlyMap<string, ValueMap> | null;
}

/** 사이드카 키(__optTexts__ 등)는 옵션 value 공간이 아니므로 건드리지 않는다 */
function isSidecarKey(key: string): boolean {
  return key.startsWith('__');
}

function remapArrayItems(items: unknown[], map: ValueMap): { value: unknown[]; count: number } {
  let count = 0;
  const next = items.map((item) => {
    if (typeof item === 'string') {
      const mapped = map.get(item);
      if (mapped === undefined) return item;
      count += 1;
      return mapped;
    }
    // 순위형 응답 항목 { rank, optionValue } — optionValue 만 치환
    if (isPlainObject(item) && typeof item['optionValue'] === 'string') {
      const mapped = map.get(item['optionValue']);
      if (mapped === undefined) return item;
      count += 1;
      return { ...item, optionValue: mapped };
    }
    return item;
  });
  return count > 0 ? { value: next, count } : { value: items, count: 0 };
}

/**
 * 한 질문의 응답 값을 리매핑한다. question_responses[qid] 와 response_answers 의
 * text_value/array_value/object_value 가 같은 값 공간이라 같은 로직을 공유한다.
 *
 * table 질문 객체(`{ cellId: value }`)는 cellMaps 에 등재된 키만 치환한다 —
 * input 셀 자유 텍스트가 같은 객체에 섞여 있으므로 셀 타입 기반 필터가 필수다.
 */
export function remapResponseValue(value: unknown, spec: QuestionResponseSpec): { value: unknown; count: number } {
  const { questionMap, cellMaps } = spec;

  if (typeof value === 'string') {
    if (!questionMap) return { value, count: 0 };
    const mapped = questionMap.get(value);
    return mapped === undefined ? { value, count: 0 } : { value: mapped, count: 1 };
  }

  if (Array.isArray(value)) {
    if (!questionMap || questionMap.size === 0) return { value, count: 0 };
    const remapped = remapArrayItems(value, questionMap);
    return { value: remapped.value, count: remapped.count };
  }

  if (!isPlainObject(value)) return { value, count: 0 };

  // response_answers.object_value 의 배열 래핑 컨테이너
  if (Array.isArray(value['__array'])) {
    if (!questionMap || questionMap.size === 0) return { value, count: 0 };
    const remapped = remapArrayItems(value['__array'] as unknown[], questionMap);
    return remapped.count > 0
      ? { value: { ...value, __array: remapped.value }, count: remapped.count }
      : { value, count: 0 };
  }

  if (!cellMaps || cellMaps.size === 0) return { value, count: 0 };

  let count = 0;
  const next: Record<string, unknown> = { ...value };
  for (const [key, cellValue] of Object.entries(value)) {
    if (isSidecarKey(key)) continue;
    const map = cellMaps.get(key);
    if (!map || map.size === 0) continue;

    if (typeof cellValue === 'string') {
      const mapped = map.get(cellValue);
      if (mapped === undefined) continue;
      next[key] = mapped;
      count += 1;
      continue;
    }
    if (Array.isArray(cellValue)) {
      const remapped = remapArrayItems(cellValue, map);
      if (remapped.count === 0) continue;
      next[key] = remapped.value;
      count += remapped.count;
    }
  }

  return count > 0 ? { value: next, count } : { value, count: 0 };
}

/** survey_responses.question_responses 전체를 리매핑 */
export function remapQuestionResponses(
  questionResponses: unknown,
  specs: ReadonlyMap<string, QuestionResponseSpec>,
): { value: unknown; count: number } {
  if (!isPlainObject(questionResponses)) return { value: questionResponses, count: 0 };

  let count = 0;
  const next: Record<string, unknown> = { ...questionResponses };
  for (const [questionId, value] of Object.entries(questionResponses)) {
    if (isSidecarKey(questionId)) continue;
    const spec = specs.get(questionId);
    if (!spec) continue;
    const remapped = remapResponseValue(value, spec);
    if (remapped.count === 0) continue;
    next[questionId] = remapped.value;
    count += remapped.count;
  }

  return count > 0 ? { value: next, count } : { value: questionResponses, count: 0 };
}

// ── 5. 스냅샷 리매핑 ──

/** questionId → (optionId → 변경) — 스냅샷 옵션은 옵션 id 로 매칭한다 */
export type SnapshotOptionChanges = ReadonlyMap<string, ReadonlyMap<string, OptionValueChange>>;

/** cellId → (optionId → 변경) */
export type SnapshotCellChanges = ReadonlyMap<string, ReadonlyMap<string, OptionValueChange>>;

/** value 폴백으로 매칭한 옵션 1건의 육안 대조용 상세 */
export interface SnapshotFallbackDetail {
  change: OptionValueChange;
  /** 스냅샷 사본 쪽 옵션 라벨 (현행 라벨과 다를 수 있어 별도로 남긴다) */
  snapshotLabel: string | null;
  /** 스냅샷 사본 쪽 옵션 id (현행과 다르기 때문에 폴백이 필요했던 것) */
  snapshotOptionId: string | null;
}

export interface SnapshotOptionApplyResult {
  value: unknown;
  /** 옵션 id 로 매칭해 적용한 수 */
  byId: number;
  /** id 가 어긋난 옛 세대 스냅샷에서 value 로 폴백 매칭해 적용한 수 */
  byValue: number;
  /** 폴백 대상이 여럿이거나 새 value 가 이미 쓰이고 있어 적용하지 못한 수 */
  conflicts: number;
  count: number;
  byValueDetails: SnapshotFallbackDetail[];
}

function migrateOption(option: Record<string, unknown>, change: OptionValueChange): Record<string, unknown> {
  return { ...option, value: change.newValue, optionCode: change.newValue, isCustomOptionCode: true };
}

/**
 * 스냅샷 옵션 배열에 변경을 적용한다.
 *
 * 1차는 옵션 id 매칭. 스냅샷은 세대별 사본이라 같은 옵션이 다른 id 로 복제된 버전이 존재하는데,
 * 응답 키는 어디까지나 value 이므로 id 가 안 맞으면 value 로 폴백 매칭한다. 폴백에서 후보가
 * 둘 이상이거나 새 value 가 이미 다른 옵션에 쓰이고 있으면 강행하지 않고 conflicts 로 센다.
 */
function applyOptionChanges(
  input: unknown,
  changes: ReadonlyMap<string, OptionValueChange> | undefined,
): SnapshotOptionApplyResult {
  if (!changes || changes.size === 0 || !Array.isArray(input)) {
    return { value: input, byId: 0, byValue: 0, conflicts: 0, count: 0, byValueDetails: [] };
  }

  const options = input as unknown[];
  const next = [...options];
  const applied = new Set<number>();
  const handled = new Set<OptionValueChange>();
  const byValueDetails: SnapshotFallbackDetail[] = [];
  let byId = 0;
  let byValue = 0;
  let conflicts = 0;

  options.forEach((option, index) => {
    if (!isPlainObject(option)) return;
    const optionId = asString(option['id']);
    if (optionId === null) return;
    const change = changes.get(optionId);
    if (!change || option['value'] !== change.oldValue) return;
    next[index] = migrateOption(option, change);
    applied.add(index);
    handled.add(change);
    byId += 1;
  });

  const finalValue = (index: number): string | null => {
    const option = next[index];
    return isPlainObject(option) ? asString(option['value']) : null;
  };

  for (const change of new Set(changes.values())) {
    if (handled.has(change)) continue;

    const candidates: number[] = [];
    let newValueTaken = false;
    next.forEach((_, index) => {
      const value = finalValue(index);
      if (value === change.oldValue && !applied.has(index)) candidates.push(index);
      if (value === change.newValue) newValueTaken = true;
    });

    const target = candidates[0];
    if (candidates.length !== 1 || target === undefined || newValueTaken) {
      if (candidates.length > 0) conflicts += 1;
      continue;
    }

    const option = next[target];
    if (!isPlainObject(option)) continue;
    next[target] = migrateOption(option, change);
    applied.add(target);
    byValue += 1;
    byValueDetails.push({
      change,
      snapshotLabel: asString(option['label']),
      snapshotOptionId: asString(option['id']),
    });
  }

  const count = byId + byValue;
  return count > 0
    ? { value: next, byId, byValue, conflicts, count, byValueDetails }
    : { value: input, byId: 0, byValue: 0, conflicts, count: 0, byValueDetails: [] };
}

export interface SnapshotRemapResult {
  snapshot: unknown;
  optionCount: number;
  /** value 폴백으로 매칭한 옵션 수 (스냅샷 사본의 옵션 id 가 현행과 다른 세대) */
  optionByValueCount: number;
  /** value 폴백 매칭 건별 상세 — DRY_RUN 육안 대조용 */
  optionByValueDetails: Array<SnapshotFallbackDetail & { questionId: string | null }>;
  /** 폴백 충돌로 적용하지 못한 수 — 남으면 orphan 증가로 이어진다 */
  optionConflictCount: number;
  conditionCount: number;
  gatingCount: number;
  changed: boolean;
}

function emptySnapshotCounts(): Omit<SnapshotRemapResult, 'snapshot'> {
  return {
    optionCount: 0,
    optionByValueCount: 0,
    optionByValueDetails: [],
    optionConflictCount: 0,
    conditionCount: 0,
    gatingCount: 0,
    changed: false,
  };
}

/**
 * survey_versions.snapshot 안 질문 구조에 동일 변환을 적용한다.
 * 응답 페이지가 스냅샷을 읽으므로 이걸 빼면 배포 전까지 신·구 value 가 섞인다.
 */
export function remapSnapshot(
  snapshot: unknown,
  optionChanges: SnapshotOptionChanges,
  cellChanges: SnapshotCellChanges,
  maps: ConditionRemapMaps,
  cellMaps: ReadonlyMap<string, ValueMap>,
): SnapshotRemapResult {
  if (!isPlainObject(snapshot)) return { snapshot, ...emptySnapshotCounts() };

  const optionByValueDetails: Array<SnapshotFallbackDetail & { questionId: string | null }> = [];
  let optionCount = 0;
  let optionByValueCount = 0;
  let optionConflictCount = 0;
  let conditionCount = 0;
  let gatingCount = 0;
  let changed = false;

  let tallyQuestionId: string | null = null;
  const tally = (result: SnapshotOptionApplyResult): void => {
    optionCount += result.count;
    optionByValueCount += result.byValue;
    optionConflictCount += result.conflicts;
    for (const detail of result.byValueDetails) {
      optionByValueDetails.push({ ...detail, questionId: tallyQuestionId });
    }
  };

  let questions = snapshot['questions'];
  if (Array.isArray(questions)) {
    const nextQuestions = questions.map((question) => {
      if (!isPlainObject(question)) return question;
      const questionId = asString(question['id']);
      let next = question;
      let questionChanged = false;

      const changesForQuestion = questionId === null ? undefined : optionChanges.get(questionId);
      tallyQuestionId = questionId;

      const options = applyOptionChanges(question['options'], changesForQuestion);
      tally(options);
      if (options.count > 0) {
        next = { ...next, options: options.value };
        questionChanged = true;
      }

      if (Array.isArray(question['selectLevels'])) {
        let levelsChanged = false;
        const nextLevels = (question['selectLevels'] as unknown[]).map((level) => {
          if (!isPlainObject(level)) return level;
          const remapped = applyOptionChanges(level['options'], changesForQuestion);
          tally(remapped);
          if (remapped.count === 0) return level;
          levelsChanged = true;
          return { ...level, options: remapped.value };
        });
        if (levelsChanged) {
          next = { ...next, selectLevels: nextLevels };
          questionChanged = true;
        }
      }

      if (isPlainObject(question['rankingConfig'])) {
        const rankingConfig = question['rankingConfig'];
        const remapped = applyOptionChanges(rankingConfig['options'], changesForQuestion);
        tally(remapped);
        if (remapped.count > 0) {
          next = { ...next, rankingConfig: { ...rankingConfig, options: remapped.value } };
          questionChanged = true;
        }
      }

      // 표 셀 옵션 — cellId + optionId 로 매칭
      if (Array.isArray(question['tableRowsData'])) {
        let rowsChanged = false;
        const nextRows = (question['tableRowsData'] as unknown[]).map((row) => {
          if (!isPlainObject(row) || !Array.isArray(row['cells'])) return row;
          let cellsChanged = false;
          const nextCells = (row['cells'] as unknown[]).map((cell) => {
            if (!isPlainObject(cell)) return cell;
            const cellId = asString(cell['id']);
            if (cellId === null) return cell;
            const changesForCell = cellChanges.get(cellId);
            if (!changesForCell) return cell;
            let nextCell = cell;
            let cellChanged = false;
            for (const field of CELL_OPTION_FIELDS) {
              const remapped = applyOptionChanges(cell[field], changesForCell);
              tally(remapped);
              if (remapped.count === 0) continue;
              nextCell = { ...nextCell, [field]: remapped.value };
              cellChanged = true;
            }
            if (!cellChanged) return cell;
            cellsChanged = true;
            return nextCell;
          });
          if (!cellsChanged) return row;
          rowsChanged = true;
          return { ...row, cells: nextCells };
        });
        if (rowsChanged) {
          next = { ...next, tableRowsData: nextRows };
          questionChanged = true;
        }
      }

      // 표시조건 + 게이팅
      if (question['displayCondition'] !== undefined) {
        const remapped = remapConditionGroup(next['displayCondition'], maps);
        if (remapped.count > 0) {
          next = { ...next, displayCondition: remapped.value };
          conditionCount += remapped.count;
          questionChanged = true;
        }
      }

      const columns = remapTableColumns(next['tableColumns'], maps);
      if (columns.count > 0) {
        next = { ...next, tableColumns: columns.value };
        conditionCount += columns.count;
        questionChanged = true;
      }

      const rows = remapTableRows(next['tableRowsData'], maps, cellMaps);
      if (rows.conditionCount + rows.gatingCount > 0) {
        next = { ...next, tableRowsData: rows.value };
        conditionCount += rows.conditionCount;
        gatingCount += rows.gatingCount;
        questionChanged = true;
      }

      if (questionChanged) changed = true;
      return questionChanged ? next : question;
    });
    if (changed) questions = nextQuestions;
  }

  let groups = snapshot['groups'];
  let groupsChanged = false;
  if (Array.isArray(groups)) {
    const nextGroups = (groups as unknown[]).map((group) => {
      if (!isPlainObject(group) || group['displayCondition'] === undefined) return group;
      const remapped = remapConditionGroup(group['displayCondition'], maps);
      if (remapped.count === 0) return group;
      conditionCount += remapped.count;
      groupsChanged = true;
      return { ...group, displayCondition: remapped.value };
    });
    if (groupsChanged) {
      groups = nextGroups;
      changed = true;
    }
  }

  if (!changed) return { snapshot, ...emptySnapshotCounts(), optionConflictCount };
  return {
    snapshot: { ...snapshot, questions, groups },
    optionCount,
    optionByValueCount,
    optionByValueDetails,
    optionConflictCount,
    conditionCount,
    gatingCount,
    changed: true,
  };
}

// ── 6. orphan 검증 ──

export interface OrphanScope {
  /** 질문 레벨 choice 옵션 value 집합. null 이면 이 질문은 orphan 판정 대상이 아님 */
  optionValues: ReadonlySet<string> | null;
  /** cellId → 셀 옵션 value 집합 */
  cellOptionValues: ReadonlyMap<string, ReadonlySet<string>> | null;
}

function countMissing(value: unknown, allowed: ReadonlySet<string>): number {
  if (typeof value === 'string') return allowed.has(value) ? 0 : 1;
  if (!Array.isArray(value)) return 0;

  let count = 0;
  for (const item of value) {
    if (typeof item === 'string') {
      if (!allowed.has(item)) count += 1;
      continue;
    }
    if (isPlainObject(item) && typeof item['optionValue'] === 'string' && !allowed.has(item['optionValue'])) {
      count += 1;
    }
  }
  return count;
}

/**
 * 옵션 value 집합에 없는 choice 응답값(orphan)을 질문별로 센다.
 * 마이그레이션 전후를 비교해 증가하면 리매핑 누락이 있다는 뜻이고, 질문별 델타가
 * 그대로 원인 지목이 된다.
 */
export function countOrphansByQuestion(
  questionResponses: unknown,
  scopes: ReadonlyMap<string, OrphanScope>,
  into: Map<string, number> = new Map(),
): Map<string, number> {
  if (!isPlainObject(questionResponses)) return into;

  const add = (questionId: string, n: number): void => {
    if (n === 0) return;
    into.set(questionId, (into.get(questionId) ?? 0) + n);
  };

  for (const [questionId, value] of Object.entries(questionResponses)) {
    if (isSidecarKey(questionId)) continue;
    const scope = scopes.get(questionId);
    if (!scope) continue;

    if (scope.optionValues && (typeof value === 'string' || Array.isArray(value))) {
      add(questionId, countMissing(value, scope.optionValues));
      continue;
    }

    if (scope.cellOptionValues && isPlainObject(value)) {
      for (const [key, cellValue] of Object.entries(value)) {
        if (isSidecarKey(key)) continue;
        const allowed = scope.cellOptionValues.get(key);
        if (!allowed) continue;
        add(questionId, countMissing(cellValue, allowed));
      }
    }
  }

  return into;
}

/** countOrphansByQuestion 의 합계 */
export function countOrphanValues(
  questionResponses: unknown,
  scopes: ReadonlyMap<string, OrphanScope>,
): number {
  let total = 0;
  for (const count of countOrphansByQuestion(questionResponses, scopes).values()) total += count;
  return total;
}

export interface OrphanDiff {
  /** [questionId, 증가량] — 하나라도 있으면 리매핑 누락이다 */
  increased: Array<[string, number]>;
  /** [questionId, 감소량] — 정상 (죽은 값이 살아난 경우) */
  decreased: Array<[string, number]>;
  beforeTotal: number;
  afterTotal: number;
  /** 실패 판정 — 총합이 아니라 스코프별 증가 유무로 본다 */
  hasIncrease: boolean;
}

/**
 * orphan 전후를 질문 스코프 단위로 비교한다.
 *
 * 총합 비교로 판정하면 어떤 질문의 orphan 감소(정상)가 다른 질문의 신규 orphan(사고)을
 * 상쇄해 게이트가 뚫린다. 증가한 스코프가 하나라도 있으면 실패로 본다.
 */
export function diffOrphanCounts(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): OrphanDiff {
  const increased: Array<[string, number]> = [];
  const decreased: Array<[string, number]> = [];
  let beforeTotal = 0;
  let afterTotal = 0;

  for (const count of before.values()) beforeTotal += count;
  for (const count of after.values()) afterTotal += count;

  for (const questionId of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(questionId) ?? 0) - (before.get(questionId) ?? 0);
    if (delta > 0) increased.push([questionId, delta]);
    if (delta < 0) decreased.push([questionId, -delta]);
  }

  increased.sort((a, b) => b[1] - a[1]);
  decreased.sort((a, b) => b[1] - a[1]);

  return { increased, decreased, beforeTotal, afterTotal, hasIncrease: increased.length > 0 };
}

/** 질문 정의(마이그레이션 전/후 어느 쪽이든)에서 orphan 판정용 옵션 value 집합을 만든다 */
export function buildOrphanScope(source: QuestionOptionSource): OrphanScope {
  const optionValues = new Set<string>();
  if (Array.isArray(source.options)) {
    for (const option of source.options) {
      if (!isPlainObject(option)) continue;
      const value = asString(option['value']);
      if (value !== null) optionValues.add(value);
    }
  }
  if (Array.isArray(source.selectLevels)) {
    for (const level of source.selectLevels) {
      if (!isPlainObject(level) || !Array.isArray(level['options'])) continue;
      for (const option of level['options'] as unknown[]) {
        if (!isPlainObject(option)) continue;
        const value = asString(option['value']);
        if (value !== null) optionValues.add(value);
      }
    }
  }

  const cellOptionValues = new Map<string, Set<string>>();
  if (Array.isArray(source.tableRowsData)) {
    for (const row of source.tableRowsData) {
      if (!isPlainObject(row) || !Array.isArray(row['cells'])) continue;
      for (const cell of row['cells'] as unknown[]) {
        if (!isPlainObject(cell)) continue;
        const cellId = asString(cell['id']);
        if (cellId === null) continue;
        for (const field of CELL_OPTION_FIELDS) {
          if (!Array.isArray(cell[field])) continue;
          const set = cellOptionValues.get(cellId) ?? new Set<string>();
          for (const option of cell[field] as unknown[]) {
            if (!isPlainObject(option)) continue;
            const value = asString(option['value']);
            if (value !== null) set.add(value);
          }
          cellOptionValues.set(cellId, set);
        }
      }
    }
  }

  return {
    optionValues: optionValues.size > 0 ? optionValues : null,
    cellOptionValues: cellOptionValues.size > 0 ? cellOptionValues : null,
  };
}
