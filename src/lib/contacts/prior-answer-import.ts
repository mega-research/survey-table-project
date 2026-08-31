/**
 * 이월 응답 임포트 — 해석·제안·값 변환 (순수).
 *
 * 파일 입출력도 데이터베이스도 모른다. 시트 내용(헤더 + 행)과 문항 목록만으로
 * 매핑 제안과 조사 대상별 값 묶음을 낸다. 임포트 사고는 대부분 이 자리에서 나므로
 * 화면·서비스와 떼어 놓고 실제 rawdata 모양으로 고정한다.
 *
 * 이 모듈은 **한 문항이 한 컬럼을 쓰는 경우만** 다룬다. 복수응답 펼침·순위 열·표 칸처럼
 * 여러 컬럼을 먹는 문항은 미매핑으로 남긴다 — 컬럼 블록 해석은 별도 소관이다.
 */

import type { Question } from '@/types/survey';
import { isGroupedChoiceQuestion } from '@/utils/choice-group-helpers';
import { resolveChoiceOptions } from '@/utils/choice-source';

/** 한 컬럼으로 값이 정해지는 문항 유형. 그 외는 이 경로에서 다루지 않는다. */
const SINGLE_COLUMN_TYPES = new Set<Question['type']>(['text', 'textarea', 'radio', 'select']);

/** 선택지 라벨을 저장값으로 바꿔야 하는 유형. */
const CHOICE_TYPES = new Set<Question['type']>(['radio', 'select']);

/**
 * 문항코드 대조용 정규화.
 *
 * 설문지에는 `BQ1-1.` 로 적히고 문항코드에는 `BQ1_1` 로 들어간다 — SPSS 변수명 규격이
 * 대시와 마침표를 거부하기 때문이다. 그 차이를 대조 시점에 흡수한다:
 * 후행 마침표 제거, 대시를 밑줄로, 공백 제거, 대소문자 무시.
 */
export function normalizeQuestionCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/\.+$/, '')
    .replace(/-/g, '_')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * 엑셀 헤더에서 대조할 코드 후보를 낸다.
 *
 * 실무 rawdata 헤더는 `BQ1-1. 창업 기업명` 처럼 코드와 문항 라벨이 한 칸에 붙어 있다.
 * 헤더 전체와 선두 토큰을 둘 다 후보로 내 어느 쪽이든 맞으면 잇는다.
 */
function headerCodeCandidates(header: string): string[] {
  const whole = normalizeQuestionCode(header);
  const leading = normalizeQuestionCode(header.trim().split(/[\s]+/)[0] ?? '');
  return leading && leading !== whole ? [whole, leading] : [whole];
}

/**
 * 조사 대상 번호 대조 키. resid 는 정수 컬럼이라 `07` 과 `7` 이 같은 대상이다 —
 * 따로 두면 적재가 같은 대상을 한 배치에 두 번 실어 통째로 실패한다.
 * 정수로 읽히지 않으면 원래 문자열을 그대로 쓴다(미매칭으로 남아 화면에 보인다).
 */
export function normalizeResid(raw: string): string {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return trimmed;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? String(parsed) : trimmed;
}

/**
 * 이 문항이 한 컬럼으로 값이 정해지는가.
 *
 * 보기 그룹이 있는 문항은 제외한다 — 저장형이 `{ groupKey: 값 }` 객체라 한 컬럼 값으로
 * 만들 수 없고, 문자열을 넣으면 프리필이 보이지 않는 채로 그 형태가 올해 응답에
 * 복사된다.
 */
export function isSingleColumnQuestion(question: Question): boolean {
  if (!SINGLE_COLUMN_TYPES.has(question.type)) return false;
  return !isGroupedChoiceQuestion(question);
}

export interface ColumnSuggestion {
  columnKey: string;
  /** 제안된 문항 id. 없으면 미매핑. */
  questionId: string | null;
  /** 무엇으로 맞췄는가. 미매핑이면 null. */
  matchedBy: 'code' | null;
}

/**
 * 엑셀 헤더와 문항을 잇는 자동 제안.
 *
 * 문항코드 정규화 대조만 쓴다. 한 문항에 두 컬럼이 걸리면 먼저 나온 컬럼이 가져간다 —
 * 같은 문항에 두 값을 실을 수 없고, 뒤 컬럼을 조용히 덮으면 어느 쪽이 들어갔는지 알 수 없다.
 */
export function suggestPriorAnswerMapping(
  headers: readonly string[],
  questions: readonly Question[],
): ColumnSuggestion[] {
  const byCode = new Map<string, Question>();
  for (const question of questions) {
    if (!isSingleColumnQuestion(question)) continue;
    const code = normalizeQuestionCode(question.questionCode);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, question);
  }

  const taken = new Set<string>();
  return headers.map((columnKey) => {
    const question = headerCodeCandidates(columnKey)
      .filter(Boolean)
      .map((code) => byCode.get(code))
      .find((found) => found !== undefined);
    if (!question || taken.has(question.id)) {
      return { columnKey, questionId: null, matchedBy: null };
    }
    taken.add(question.id);
    return { columnKey, questionId: question.id, matchedBy: 'code' as const };
  });
}

/** 문항별 선택지 변환 실패 집계 — 어느 값이 어느 선택지에도 안 맞았는지 그대로 남긴다. */
export interface OptionMismatch {
  questionId: string;
  /** 이 문항에 값이 들어 있던 행 수 */
  total: number;
  /** 그중 어느 선택지에도 맞지 않은 행 수 */
  unmatched: number;
  /** 맞지 않은 원본 값과 그 건수 (건수 내림차순) */
  values: Array<{ value: string; count: number }>;
}

export interface PriorAnswerImportInput {
  rows: ReadonlyArray<Record<string, string>>;
  /** 조사 대상을 찾을 열 — 설문별 자동 발번 번호(시스템ID)가 들어 있다. */
  residColumnKey: string;
  /** 컬럼 키 → 문항 id */
  mapping: Readonly<Record<string, string>>;
  questions: readonly Question[];
}

export interface PriorAnswerImportResult {
  /** 조사 대상 번호별 값 묶음. 값이 하나도 없는 대상은 담지 않는다. */
  records: Array<{ resid: string; answers: Record<string, unknown> }>;
  optionMismatches: OptionMismatch[];
  /** 조사 대상 번호가 비어 버린 행 수 */
  emptyResidRows: number;
  /** 같은 번호가 다시 나와 앞 행을 덮은 횟수 */
  duplicateResidRows: number;
  /** 이 경로가 다룰 수 없는 문항으로 매핑돼 값을 만들지 않은 문항 id */
  unsupportedQuestionIds: string[];
}

/** 선택지 라벨 대조 키 — 앞뒤 공백과 대소문자를 무시한다. */
function optionLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * 시트 행을 조사 대상별 값 묶음으로 바꾼다.
 *
 * 값은 응답 저장 형태와 동형으로 나온다 — 선택지 문항은 라벨 텍스트를 저장값으로
 * 변환하고, 어느 선택지에도 맞지 않으면 **그 문항만 비우고** 집계에 남긴다.
 * 빈 셀은 값을 만들지 않는다: 빈칸으로 덮어쓰면 지난 회차에 답이 있었는지 없었는지
 * 구분이 사라진다.
 */
export function buildPriorAnswerRecords(
  input: PriorAnswerImportInput,
): PriorAnswerImportResult {
  const questionById = new Map(input.questions.map((q) => [q.id, q]));
  const optionValueByLabel = new Map<string, Map<string, string>>();
  const unsupported = new Set<string>();

  // 매핑된 문항만 미리 해석해 둔다 — 행마다 선택지를 다시 펴지 않는다.
  const columnTargets: Array<{ columnKey: string; question: Question }> = [];
  for (const [columnKey, questionId] of Object.entries(input.mapping)) {
    const question = questionById.get(questionId);
    if (!question) continue;
    if (!isSingleColumnQuestion(question)) {
      unsupported.add(questionId);
      continue;
    }
    columnTargets.push({ columnKey, question });
    if (CHOICE_TYPES.has(question.type)) {
      const labels = new Map<string, string>();
      for (const option of resolveChoiceOptions(question)) {
        const key = optionLabelKey(option.label ?? '');
        if (key && !labels.has(key)) labels.set(key, option.value);
      }
      optionValueByLabel.set(question.id, labels);
    }
  }

  const byResid = new Map<string, Record<string, unknown>>();
  const seenResid = new Set<string>();
  const mismatchByQuestion = new Map<
    string,
    { total: number; unmatched: number; counts: Map<string, number> }
  >();
  let emptyResidRows = 0;
  let duplicateResidRows = 0;

  for (const row of input.rows) {
    const resid = normalizeResid(row[input.residColumnKey] ?? '');
    if (!resid) {
      emptyResidRows += 1;
      continue;
    }
    if (seenResid.has(resid)) duplicateResidRows += 1;
    seenResid.add(resid);

    const answers: Record<string, unknown> = {};
    for (const { columnKey, question } of columnTargets) {
      const raw = (row[columnKey] ?? '').trim();
      if (!raw) continue;

      const labels = optionValueByLabel.get(question.id);
      if (!labels) {
        answers[question.id] = raw;
        continue;
      }

      const stat = mismatchByQuestion.get(question.id) ?? {
        total: 0,
        unmatched: 0,
        counts: new Map<string, number>(),
      };
      stat.total += 1;
      const value = labels.get(optionLabelKey(raw));
      if (value === undefined) {
        // 그 문항만 비운다 — 나머지 문항 값은 그대로 살린다.
        stat.unmatched += 1;
        stat.counts.set(raw, (stat.counts.get(raw) ?? 0) + 1);
      } else {
        answers[question.id] = value;
      }
      mismatchByQuestion.set(question.id, stat);
    }

    // 이 행에 살아남은 값이 없으면 아무것도 하지 않는다 — 같은 번호의 앞 행이 이미
    // 들고 있는 값을 빈 묶음으로 덮거나 지우지 않는다.
    if (Object.keys(answers).length === 0) continue;
    byResid.set(resid, answers);
  }

  const optionMismatches: OptionMismatch[] = [];
  for (const [questionId, stat] of mismatchByQuestion) {
    if (stat.unmatched === 0) continue;
    optionMismatches.push({
      questionId,
      total: stat.total,
      unmatched: stat.unmatched,
      values: [...stat.counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    });
  }

  return {
    records: [...byResid.entries()].map(([resid, answers]) => ({ resid, answers })),
    optionMismatches,
    emptyResidRows,
    duplicateResidRows,
    unsupportedQuestionIds: [...unsupported],
  };
}
