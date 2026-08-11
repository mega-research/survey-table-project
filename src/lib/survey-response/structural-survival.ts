import type { Question, QuestionOption, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { unwrapOptionId } from '@/utils/table-cell-semantics';

/**
 * 구조 생존 판정 (structural survival) — CONTEXT.md 용어, ADR-0014.
 *
 * 응답 버전 이관에서 기존 답변의 유지/폐기를 가르는 순수 규칙의 단일 거처.
 * 서버(재개 이관)와 클라이언트(무중단 갈아타기)가 공유한다 — DB·server-only 의존 금지.
 *
 * 원칙: 참조 구조가 사라졌다는 "긍정적 증거"가 있을 때만 폐기한다.
 * 판별 불능(미지의 값 모양, legacy 객체, 표시 셀 값 등)은 유지 — 잘못 유지의 비용
 * (렌더 안 되는 값 잔존)은 경미하지만 잘못 폐기는 응답 데이터 파괴이기 때문이다.
 * 문구·라벨의 의미 변화는 판정하지 않는다 — 완료 응답도 동일하게 노출되는 문제라
 * 판단은 배포하는 관리자 몫이다.
 */
export interface StructuralSurvivalResult {
  /** 생존한 답변 맵 — 변화 없는 값은 참조 동일성 유지 */
  survivingResponses: Record<string, unknown>;
  /** 답이 폐기되거나 값이 일부 제거된 질문 ID (재개 위치 롤백의 입력) */
  affectedQuestionIds: string[];
}

/** questionResponses 최상위의 질문 ID 가 아닌 예약 키 — 무조건 통과 */
const RESERVED_TOP_LEVEL_KEYS = new Set(['__optTexts__']);

/** 저장값이 옵션 실존 판정 가능한 plain string 인가 (빈 문자열은 미응답 취급 — 판정 제외) */
function isJudgeableString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * 저장값으로 옵션 실존 판정 — table-cell-semantics.findOptionByStored 와 동일 정책:
 * 인터랙티브 컨트롤은 `option.value ?? option.id` 를 저장하므로 id/value 둘 다로 찾는다.
 */
function optionExists(
  options: ReadonlyArray<{ id: string; value?: string }>,
  stored: string,
): boolean {
  return options.some((opt) => opt.id === stored || (opt.value != null && opt.value === stored));
}

/** 질문의 모든 테이블 셀 (isHidden 포함 — 구조 실존 판정이므로 표시 여부와 무관) */
function collectAllCells(question: Question): Map<string, TableCell> {
  const map = new Map<string, TableCell>();
  for (const rowData of question.tableRowsData ?? []) {
    for (const c of rowData.cells) map.set(c.id, c);
  }
  return map;
}

/** ranking 질문의 옵션 소스 (manual: options / table: ranking_opt 셀) — id/value 판정용 */
function rankingOptionSource(question: Question): Array<{ id: string; value?: string }> {
  if (question.rankingConfig?.optionsSource === 'table') {
    const cells: Array<{ id: string }> = [];
    for (const rowData of question.tableRowsData ?? []) {
      for (const c of rowData.cells) {
        if (c.type === 'ranking_opt') cells.push({ id: c.id });
      }
    }
    return cells;
  }
  return question.options ?? [];
}

/** RankingAnswer 배열에서 고아 항목만 제거. 판별 불능 항목은 유지. */
function filterRankingEntries(
  value: unknown[],
  source: ReadonlyArray<{ id: string; value?: string }>,
): { filtered: unknown[]; removed: boolean } {
  let removed = false;
  const filtered = value.filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return true;
    const optionValue = (entry as { optionValue?: unknown }).optionValue;
    if (!isJudgeableString(optionValue)) return true;
    if (optionValue === '__other__') return true;
    if (optionExists(source, optionValue)) return true;
    removed = true;
    return false;
  });
  return { filtered, removed };
}

/** string 배열(checkbox/multiselect)에서 고아 값만 제거. 비문자열 항목은 유지. */
function filterStringArray(
  value: unknown[],
  source: ReadonlyArray<{ id: string; value?: string }>,
  unwrap: (item: unknown) => string | null,
): { filtered: unknown[]; removed: boolean } {
  let removed = false;
  const filtered = value.filter((item) => {
    const stored = unwrap(item);
    if (stored === null || stored === '') return true; // 판별 불능 — 유지
    if (optionExists(source, stored)) return true;
    removed = true;
    return false;
  });
  return { filtered, removed };
}

/** multiselect: 전체 selectLevels 옵션 유니온 (레벨 구조 내 위치까지는 판정하지 않는다) */
function multiselectOptionUnion(question: Question): QuestionOption[] {
  return (question.selectLevels ?? []).flatMap((level) => level.options ?? []);
}

type CellVerdict =
  | { kind: 'keep' }
  | { kind: 'drop' }
  | { kind: 'replace'; value: unknown };

/** 테이블 셀 하나의 저장값 판정 */
function judgeCellValue(cellDef: TableCell, value: unknown): CellVerdict {
  switch (cellDef.type) {
    case 'checkbox': {
      if (!Array.isArray(value)) return { kind: 'drop' }; // 모양 비양립 (셀 타입 변경)
      const { filtered, removed } = filterStringArray(
        value,
        cellDef.checkboxOptions ?? [],
        unwrapOptionId,
      );
      return removed ? { kind: 'replace', value: filtered } : { kind: 'keep' };
    }
    case 'radio':
    case 'select': {
      if (Array.isArray(value)) return { kind: 'drop' };
      const stored = unwrapOptionId(value);
      if (stored === null || stored === '') return { kind: 'keep' }; // 판별 불능 — 유지
      const options = cellDef.type === 'radio' ? cellDef.radioOptions : cellDef.selectOptions;
      return optionExists(options ?? [], stored) ? { kind: 'keep' } : { kind: 'drop' };
    }
    case 'input':
      // 문자열/숫자 모양이면 유지 (inputType 텍스트↔숫자 변경 포함). 배열/객체는 비양립.
      return Array.isArray(value) || (typeof value === 'object' && value !== null)
        ? { kind: 'drop' }
        : { kind: 'keep' };
    case 'ranking': {
      if (!Array.isArray(value)) return { kind: 'drop' };
      const { filtered, removed } = filterRankingEntries(value, cellDef.rankingOptions ?? []);
      return removed ? { kind: 'replace', value: filtered } : { kind: 'keep' };
    }
    default:
      // 표시 셀(text/image/video/calc/choice_opt/ranking_opt) 아래의 값 — 의미를 모르는
      // 저장분이므로 보수적으로 유지 (calc 는 저장 경계에서 어차피 재계산된다).
      return { kind: 'keep' };
  }
}

/** 테이블 질문 답(Record<cellId, value>) 판정 */
function judgeTableAnswer(
  question: Question,
  value: Record<string, unknown>,
): { surviving: Record<string, unknown>; changed: boolean } {
  const cells = collectAllCells(question);
  const surviving: Record<string, unknown> = {};
  let changed = false;
  for (const [key, cellValue] of Object.entries(value)) {
    // 레거시 사이드카(질문 객체 내 optionTexts)는 셀 키가 아니다 — 통과
    if (key === 'optionTexts') {
      surviving[key] = cellValue;
      continue;
    }
    const cellDef = cells.get(key);
    if (!cellDef) {
      changed = true; // 고아 셀 키 — 제거
      continue;
    }
    const verdict = judgeCellValue(cellDef, cellValue);
    if (verdict.kind === 'drop') {
      changed = true;
      continue;
    }
    if (verdict.kind === 'replace') {
      changed = true;
      surviving[key] = verdict.value;
      continue;
    }
    surviving[key] = cellValue;
  }
  return { surviving, changed };
}

type QuestionVerdict =
  | { kind: 'keep' }
  | { kind: 'drop' }
  | { kind: 'replace'; value: unknown };

/** 질문 하나의 답변 판정 — 신버전 질문 정의 기준 */
function judgeQuestionAnswer(question: Question, value: unknown): QuestionVerdict {
  switch (question.type) {
    case 'text':
    case 'textarea':
      // 문자열/숫자 모양이면 유지 (inputType·piiEncrypted 변경 무관). 배열/객체는 타입 변경.
      return Array.isArray(value) || (typeof value === 'object' && value !== null)
        ? { kind: 'drop' }
        : { kind: 'keep' };
    case 'radio':
    case 'select': {
      if (Array.isArray(value)) return { kind: 'drop' }; // checkbox 류에서 타입 변경
      if (isJudgeableString(value)) {
        // radio/checkbox 는 테이블-소스(choice_opt) 가능 — resolveChoiceOptions 가
        // manual options / cell.id 옵션을 통합 반환한다. select 는 manual 전용.
        const options =
          question.type === 'radio' ? resolveChoiceOptions(question) : (question.options ?? []);
        return optionExists(options, value) ? { kind: 'keep' } : { kind: 'drop' };
      }
      // legacy 기타 객체({selectedValue, otherValue}) 등 판별 불능 모양 — 유지
      return { kind: 'keep' };
    }
    case 'checkbox': {
      if (!Array.isArray(value)) return { kind: 'drop' };
      const { filtered, removed } = filterStringArray(
        value,
        resolveChoiceOptions(question),
        (item) => (typeof item === 'string' ? item : null),
      );
      return removed ? { kind: 'replace', value: filtered } : { kind: 'keep' };
    }
    case 'multiselect': {
      if (!Array.isArray(value)) return { kind: 'drop' };
      const { filtered, removed } = filterStringArray(
        value,
        multiselectOptionUnion(question),
        (item) => (typeof item === 'string' ? item : null),
      );
      return removed ? { kind: 'replace', value: filtered } : { kind: 'keep' };
    }
    case 'ranking': {
      if (!Array.isArray(value)) return { kind: 'drop' };
      const { filtered, removed } = filterRankingEntries(value, rankingOptionSource(question));
      return removed ? { kind: 'replace', value: filtered } : { kind: 'keep' };
    }
    case 'table': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { kind: 'drop' };
      }
      const { surviving, changed } = judgeTableAnswer(question, value as Record<string, unknown>);
      return changed ? { kind: 'replace', value: surviving } : { kind: 'keep' };
    }
    case 'notice':
      return { kind: 'keep' };
    default:
      return { kind: 'keep' };
  }
}

/**
 * 기존 답변 맵을 신버전 질문 구조로 걸러 { 생존 답변, 영향 질문 ID } 를 돌려준다.
 *
 * - 신버전에 없는 질문의 답 → 폐기 + affected
 * - 타입 변경(응답값 모양 비양립) → 그 답만 폐기 + affected
 * - 고아 값(삭제된 옵션·셀 참조) → 값 단위 제거 + affected
 * - 변화 없는 답 → 값 참조 동일성 유지 통과
 */
export function applyStructuralSurvival(
  responses: Record<string, unknown>,
  newQuestions: Question[],
): StructuralSurvivalResult {
  const questionById = new Map(newQuestions.map((question) => [question.id, question]));
  const surviving: Record<string, unknown> = {};
  const affected: string[] = [];

  for (const [key, value] of Object.entries(responses)) {
    if (RESERVED_TOP_LEVEL_KEYS.has(key)) {
      surviving[key] = value;
      continue;
    }
    const question = questionById.get(key);
    if (!question) {
      affected.push(key);
      continue;
    }
    const verdict = judgeQuestionAnswer(question, value);
    if (verdict.kind === 'drop') {
      affected.push(key);
      continue;
    }
    if (verdict.kind === 'replace') {
      affected.push(key);
      surviving[key] = verdict.value;
      continue;
    }
    surviving[key] = value;
  }

  return { survivingResponses: surviving, affectedQuestionIds: affected };
}
