/**
 * 이월 응답 임포트 — 3단 병합 헤더와 컬럼 블록 (순수).
 *
 * 실무 rawdata 헤더는 세 줄이다: 파트 행 / 문항코드 행 / 세부 라벨 행.
 * 문항코드 행은 첫 칸에만 코드가 있고(병합했든 그냥 비웠든) **값이 있는 칸부터 다음 값이
 * 나오기 전까지**가 한 문항의 컬럼 블록이다. 그 블록 단위로 이어야 아홉 칸짜리 표 문항, 열 칸으로 펼쳐진 복수응답,
 * 1순위·2순위로 나뉜 순위 문항이 통째로 붙는다.
 *
 * 파일 입출력도 데이터베이스도 모른다 — 헤더/데이터 격자와 문항 목록만 받는다.
 */

import type { Question, QuestionOption, TableCell } from '@/types/survey';
import { isGroupedChoiceQuestion } from '@/utils/choice-group-helpers';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { resolveRankingOptions } from '@/utils/ranking-source';

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

/** 3단 헤더에서 잘라낸 한 문항의 컬럼 블록. */
export interface HeaderBlock {
  /** 문항코드 행 원문(블록 첫 칸). 실무 파일은 `BQ1-1. 창업 기업명` 처럼 코드와 라벨이 붙어 있다. */
  codeText: string;
  /** codeText 의 선두 토큰 — 문항코드 후보. */
  code: string;
  /**
   * 문항 내용 대조용 텍스트. codeText 에서 코드를 뺀 나머지이며, 비어 있고 블록이 한 칸이면
   * 세부 라벨을 쓴다. 코드가 밀린 파일을 잡아내는 근거라 코드와 별개로 들고 있는다.
   */
  label: string;
  /**
   * label 의 출처. 코드 칸에 붙은 라벨(`BQ7. 창업 지원 만족도`)만 문항 내용으로 믿고
   * 4분면 게이트에 쓴다. 세부 라벨 행에서 끌어온 것은 코드북 약칭(`(현재상태)`,
   * `(1년 이내 이직경험)`)이라 제목과 유사도가 나오지 않는다 — 2025 파일에서 한 칸
   * 문항 21개 중 20개가 이 이유로 code-conflict 가 됐다. 후보 제안에는 여전히 쓴다.
   */
  labelSource: 'code' | 'detail' | 'none';
  /** 이 블록이 차지하는 컬럼 인덱스(0-based, 오름차순). */
  columnIndexes: number[];
  /** 파트 행 텍스트 — 블록 첫 칸 기준. 없으면 빈 문자열. */
  part: string;
  /** 세부 라벨 행 텍스트. columnIndexes 와 같은 순서·길이. */
  detailLabels: string[];
}

/** 블록의 한 컬럼이 문항의 어느 자리에 들어가는가. */
export type BlockSlot =
  /** 문항 값 전체가 이 한 칸이다. */
  | { kind: 'single' }
  /** 표 문항의 한 칸. 저장 형태가 셀 타입마다 다르므로 타입을 함께 싣는다. */
  | { kind: 'table-cell'; cellId: string; cellType: TableCell['type'] }
  /** 복수응답 펼침의 한 보기. */
  | { kind: 'checkbox-option'; optionValue: string }
  /** 순위 문항의 한 순위(1-based). */
  | { kind: 'ranking-rank'; rank: number }
  /**
   * 어느 자리인지 정하지 못했다 — 값을 만들지 않는다.
   * reason 은 표 칸 라벨 폴백이 후보 여럿에서 멈춘 경우의 설명 — 담당자가 칸 배정 줄에서 그대로 본다.
   */
  | { kind: 'unmatched'; reason?: string };

/**
 * 블록↔문항 판정.
 *
 * - `auto` — 코드가 맞고 문항 내용도 유사하다. 그대로 제안한다.
 * - `code-conflict` — 코드는 맞는데 **문항 내용이 다르다**. 매핑하지 않고 경고한다.
 *   지난 회차에 파트가 재편되며 코드가 한 칸씩 밀린 실제 사례가 있어, 코드만 믿으면
 *   지난 회차 만족도 값이 올해 창업의향 문항에 조용히 꽂힌다.
 * - `value-conflict` — 코드는 맞는데 **블록의 실제 값이 그 문항의 보기와 맞지 않는다**.
 *   코드 칸에 라벨이 없는 파일(2025 rawdata 전부)은 위 게이트가 한 번도 안 걸려, 2025
 *   `HQ1.`(과정 도움도)이 2026 HQ1(창업 의향)에 auto 로 붙어 180/180 실패했다. 표본값
 *   적합도가 그 구멍을 막는다.
 * - `label-candidate` — 코드는 다른데 문항 내용이 같다(`matchedBy: 'label'`), 또는 값이
 *   다른 문항의 보기와 맞는다(`matchedBy: 'value'`). 후보로 제안하되 확인을 요구한다.
 * - `unmapped` — 그 외.
 */
export type BlockVerdict = 'auto' | 'code-conflict' | 'value-conflict' | 'label-candidate' | 'unmapped';

export interface BlockSuggestion {
  block: HeaderBlock;
  questionId: string | null;
  matchedBy: 'code' | 'label' | 'value' | null;
  verdict: BlockVerdict;
  /** code-conflict·value-conflict·value 후보일 때 코드가 가리킨 문항 — 담당자가 무엇과 충돌했는지 알아야 한다. */
  conflictQuestionId?: string;
  /** 값 적합도 판정의 근거 — 표본 건수와 대상 문항. 마법사가 배지 아래 한 줄로 그대로 찍는다. */
  verdictReason?: string;
  /** block.columnIndexes 와 같은 순서·길이. */
  slots: BlockSlot[];
}

/** 한 열의 값 하나와 그 건수. */
export interface ColumnValueCount {
  value: string;
  count: number;
}

/** suggestBlockMapping 의 값 적합도 입력. 없으면 적합도를 계산하지 않는다(기존 3인자 호출과 동일). */
export interface SuggestOptions {
  /** 컬럼 인덱스 → 값 분포(건수 내림차순). collectColumnValueCounts 의 결과. */
  valueCountsByColumn?: ReadonlyMap<number, ReadonlyArray<ColumnValueCount>>;
  /** 문항 id → { 원본 값 → 저장값 }. 보관된 값 대응은 적합도에 포함한다 — 담당자가 이미 이어준 값이다. */
  valueAliases?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** 표본값 적합도 — 블록 값 중 그 문항의 보기에 맞는 건수. */
export interface SampleFit {
  matched: number;
  total: number;
}

/** 표본이 이보다 적으면 적합도로 판정을 뒤집지 않는다 — 값 한두 건에 흔들리지 않게. */
export const VALUE_FIT_MIN_SAMPLES = 3;
/**
 * 코드 일치 문항의 적합도가 이 값 미만이면 auto 가 아니라 value-conflict 다.
 * 0 이 아닌 이유: 2025 AQ1-1 열 1,804행에 `취업` 이 한 건 섞여 있어 정확히 0 이 아니다(0.6%).
 */
export const VALUE_FIT_CONFLICT_BELOW = 0.05;
/** 다른 문항을 후보로 제안하려면 적합도가 이 값 이상이어야 한다. */
export const VALUE_FIT_CANDIDATE_MIN = 0.8;

/**
 * 문항 내용 유사도(0~1). 정규화 후 같으면 1, 아니면 바이그램 Dice 계수.
 *
 * 완전 일치만 보면 조사표를 옮겨 적으며 생긴 사소한 차이("~입니까" ↔ "~습니까")에
 * 전부 경고가 뜨고, 아예 안 보면 코드가 밀린 사고를 못 잡는다.
 */
export function labelSimilarity(a: string, b: string): number {
  const left = labelKey(a);
  const right = labelKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const bigrams = (text: string) => {
    const grams = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i++) {
      const gram = text.slice(i, i + 2);
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
    }
    return grams;
  };
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let shared = 0;
  for (const [gram, count] of leftGrams) {
    shared += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  const total = left.length - 1 + (right.length - 1);
  return total > 0 ? (2 * shared) / total : 0;
}

/** 이 값 이상이면 "문항 내용이 유사하다"고 본다. */
export const LABEL_SIMILAR_THRESHOLD = 0.6;

/** 한 칸의 텍스트로 값이 정해지는 문항 유형. 그 외는 이 경로가 값을 만들지 않는다. */
const SINGLE_CELL_TYPES = new Set<Question['type']>(['text', 'textarea', 'radio', 'select']);

/**
 * 블록 코드가 문항코드 꼴인가 — 영문으로 시작하고 숫자가 든 토큰(`AQ1-1.`·`IQ1.`·`A01`).
 *
 * 값 후보 검색은 "문항이라고 주장하는 블록에 어느 문항인지 찾아 주는" 것이라, 명단 메타 열
 * (`UID`·`기수`·`현재상태`·`비고`)에는 걸지 않는다. 2025 파일 앞머리의 "2024년 조사 결과 /
 * 현재상태" 열이 AQ1_1 보기에 80% 맞아 그 문항을 먼저 가져가면, 코드가 바뀐 AQ1-2. 블록이
 * 제안받을 문항이 없어진다.
 */
function looksLikeQuestionCode(code: string): boolean {
  const normalized = normalizeQuestionCode(code);
  return /^[a-z][a-z0-9_]*$/.test(normalized) && /\d/.test(normalized);
}

/** 문항코드 대조 후보 — 헤더 전체와 선두 토큰. */
function headerCodeCandidates(header: string): string[] {
  const whole = normalizeQuestionCode(header);
  const leading = normalizeQuestionCode(header.trim().split(/\s+/)[0] ?? '');
  const candidates = leading && leading !== whole ? [whole, leading] : [whole];
  return candidates.filter(Boolean);
}

/**
 * 엑셀 수식 오류 표식. 값이 아니라 "계산이 깨졌다"는 흔적이라 어느 판정에도 쓰면 안 된다 —
 * 표본으로 삼으면 보기 배정이 어긋나고, 선택 표기로 읽으면 복수응답이 켜진다.
 */
const EXCEL_ERROR_VALUES = new Set(['#REF!', '#N/A', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!']);

export function isExcelErrorValue(value: string): boolean {
  return EXCEL_ERROR_VALUES.has(value.trim().toUpperCase());
}

/**
 * 값이 아니라 "비어 있음"의 표기. 2025 export 잔재('[object Object]'·'직접입력')와 손으로
 * 찍은 빈칸 표기('--'·'-'·'.')가 그대로 이월되면 잠긴 입력에 그 글자가 채워지고 변동 확인이
 * 붙는다. 'x'·'없음' 처럼 문항에 따라 뜻이 있는 것은 넣지 않는다.
 */
const PLACEHOLDER_VALUES = new Set(['[object object]', '직접입력', '--', '-', '.', '…', '...']);

/** 셀 값을 판정에 쓰는 형태로 — 공백을 다듬고 오류 표식·빈칸 표기는 빈 값으로 본다. */
function cleanCell(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (isExcelErrorValue(trimmed) || PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return '';
  return trimmed;
}

/**
 * 라벨 대조 키 — 공백·대소문자를 무시하고, 표기 차이를 흡수한다.
 * - 가운뎃점 4종(·‧ㆍ•)을 하나로: 2025 "경제‧사회" ↔ 2026 "경제·사회"
 * - 2026 보기 앞의 원문자 번호(①②…)와 뒤의 라우팅 꼬리("(▶ 'DQ2'로 이동)")는 보기가 아니다
 */
function labelKey(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[\u2027\u00b7\u318d\u2022]/g, '·')
    .replace(/^[①-⑳㉑-㉟]\s*/, '')
    .replace(/\(?▶[^)]*\)?/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 괄호 꼬리를 뗀 키 — "기타(직접 입력 : )"·"재학/휴학(고등학교/…)" 를 "기타"·"재학/휴학" 로. */
function labelStemKey(value: string | null | undefined): string {
  return labelKey((value ?? '').replace(/\s*[(（][^()（）]*[)）]\s*$/, ''));
}

/** 2지 문항의 긍정/부정 동의어 — 2025 "있음/없음" 이 2026 "있다/없다"·"예/아니오" 로 바뀐 사례가 여섯 문항이다. */
const BINARY_YES = new Set(['있음', '있다', '예', '네', '맞음', '맞다', '동의', 'o', 'y', 'yes', 'true']);
const BINARY_NO = new Set(['없음', '없다', '아니오', '아니요', '아님', '아니다', '동의하지않음', 'x', 'n', 'no', 'false']);

function binaryClass(value: string): 'yes' | 'no' | null {
  const key = labelStemKey(value);
  if (!key) return null;
  if (BINARY_YES.has(key)) return 'yes';
  if (BINARY_NO.has(key)) return 'no';
  // 2025 코더가 서술형으로 재코딩한 값 — "창업 기업이 맞음"·"신규 창업 없음"·"매출 없음".
  // 끝말이 극을 정한다. 긴 말부터 보아 "아니오" 가 "오" 로 잘못 잡히지 않게 한다.
  const endsWithAny = (words: Set<string>) =>
    [...words].sort((a, b) => b.length - a.length).some((w) => w.length >= 2 && key.endsWith(w));
  if (endsWithAny(BINARY_NO)) return 'no';
  if (endsWithAny(BINARY_YES)) return 'yes';
  return null;
}

/**
 * 3단 헤더를 컬럼 블록으로 자른다.
 *
 * 코드 행의 빈 칸은 앞 칸의 코드를 이어받는다(가로 병합). 병합 없이 코드가 칸마다
 * 반복된 파일도 같은 결과가 나오도록 **같은 코드가 이어지는 구간**을 한 블록으로 본다.
 * 코드가 나오기 전의 앞 칸들은 어느 문항에도 속하지 않아 블록이 되지 않는다.
 *
 * 빈 코드 칸이 앞 문항을 잇지 **않는** 경우가 하나 있다 — 그 칸의 파트 행에 제목이 있을 때다.
 * 실무 파일은 문항 뒤에 "비고"·"출처(2차자료)" 같은 메타 열을 파트 행에만 적고 코드 행을
 * 비워 둔다. 이 열을 앞 문항에 붙이면 단답 문항이 세 칸짜리 블록이 돼 값을 만들지 못한다.
 * 그런 열은 파트 행 제목을 코드 삼아 **자기 블록**이 된다 — 화면에서 보이고, 문항에는
 * 이어지지 않는다.
 *
 * @param headerRows 헤더 행들. 길이 3이면 [파트, 코드, 세부라벨], 2면 [코드, 세부라벨],
 *   1이면 [코드] 로 읽는다.
 */
export function splitHeaderBlocks(headerRows: readonly (readonly string[])[]): HeaderBlock[] {
  const rowCount = headerRows.length;
  const partRow = rowCount >= 3 ? headerRows[rowCount - 3] : undefined;
  const codeRow = rowCount >= 2 ? headerRows[rowCount - 2] : headerRows[0];
  const detailRow = rowCount >= 2 ? headerRows[rowCount - 1] : undefined;
  if (!codeRow) return [];

  const columnCount = Math.max(
    ...headerRows.map((row) => row.length),
    0,
  );

  const blocks: HeaderBlock[] = [];
  let carriedCode = '';
  for (let col = 0; col < columnCount; col++) {
    const codeCell = (codeRow[col] ?? '').trim();
    const partCell = (partRow?.[col] ?? '').trim();
    // 코드 칸이 비었는데 파트 행에 제목이 있다 — 앞 문항의 뻗은 칸이 아니라 메타 열이다.
    // 파트 제목을 코드 삼아 자기 블록을 세운다(문항코드가 아니라 어느 문항에도 붙지 않는다).
    const raw = codeCell || (partCell && !codeCell ? partCell : '');
    if (raw) carriedCode = raw;
    // 그 외의 빈 코드 칸은 **언제나** 앞 문항을 잇는다. 실무 rawdata 는 가로 병합을 쓰지
    // 않고 코드를 첫 칸에만 적은 뒤 나머지를 비워 둔다 — 2025 AI·SW마에스트로 파일이
    // 그렇다(병합 0건, 여러 칸 블록 20개). "병합 종속 칸일 때만 잇는다"로 두면 그 블록이
    // 전부 한 칸으로 붕괴한다. 그래서 병합 여부는 신호로 쓰지 않는다.
    const code = raw || carriedCode;
    // 코드가 아직 한 번도 나오지 않은 앞 칸 — 어느 문항에도 속하지 않는다.
    if (!code) continue;

    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.codeText === code) {
      last.columnIndexes.push(col);
      last.detailLabels.push((detailRow?.[col] ?? '').trim());
      continue;
    }
    const [leading, ...rest] = code.split(/\s+/);
    const label = rest.join(' ').trim();
    blocks.push({
      codeText: code,
      code: leading ?? code,
      label,
      labelSource: label ? 'code' : 'none',
      columnIndexes: [col],
      part: (partRow?.[col] ?? '').trim(),
      detailLabels: [(detailRow?.[col] ?? '').trim()],
    });
  }
  // 코드 칸에 라벨이 없을 때만 세부 라벨을 문항 내용으로 본다. 그것도 **한 칸짜리 블록**
  // 에서만이다 — 여러 칸 블록의 세부 라벨은 칸 이름이지 문항 내용이 아니라서, 그대로
  // 대조하면 표·복수응답·순위 블록마다 거짓 경고가 뜬다.
  for (const block of blocks) {
    if (!block.label && block.columnIndexes.length === 1) {
      block.label = block.detailLabels.filter(Boolean).join(' ');
      if (block.label) block.labelSource = 'detail';
    }
  }
  return blocks;
}

/** 표에서 값을 받을 수 있는 한 칸. 행 번호는 세부 라벨 후보의 유일성을 **행 단위**로 세는 근거다. */
interface AnswerableCell {
  cell: TableCell;
  rowIndex: number;
  rowLabel: string;
  colLabel: string;
}

/**
 * 표 문항에서 값을 받을 수 있는 칸(읽는 순서).
 *
 * 표시 전용 셀과 **계산 셀(calc)** 은 제외한다 — 계산 셀은 수식 결과가 곧 값이라
 * 외부 값을 적재하면 "수식 결과와 다른 저장값" 이라는 없는 상태를 만든다.
 */
function collectAnswerableCells(question: Question): AnswerableCell[] {
  const result: AnswerableCell[] = [];
  (question.tableRowsData ?? []).forEach((row, rowIndex) => {
    row.cells?.forEach((cell, colIdx) => {
      if (cell.isHidden) return;
      if (!['input', 'checkbox', 'radio', 'select'].includes(cell.type)) return;
      result.push({
        cell,
        rowIndex,
        rowLabel: row.label ?? '',
        colLabel: question.tableColumns?.[colIdx]?.label ?? '',
      });
    });
  });
  return result;
}

/** 표 셀의 선택지. 셀 타입별 필드가 달라 한 곳에서 모은다. */
function cellOptions(cell: TableCell): QuestionOption[] {
  if (cell.type === 'checkbox') return (cell.checkboxOptions ?? []) as QuestionOption[];
  if (cell.type === 'radio') return (cell.radioOptions ?? []) as QuestionOption[];
  if (cell.type === 'select') return cell.selectOptions ?? [];
  return [];
}

/** "2025년 1월"·"25년 5월"·"2026년1월" → { year: '2025', month: '1' }. 아니면 null. */
export function splitYearMonth(value: string): { year: string; month: string } | null {
  const match = value.trim().match(/^(\d{2,4})\s*년\s*(\d{1,2})\s*월$/);
  if (!match) return null;
  const rawYear = match[1] ?? '';
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return { year, month: String(Number(match[2])) };
}

/** 이 셀이 속한 행의 input 셀 id 들(읽는 순서). 년·월 두 칸 분해의 근거. */
function inputCellsInRowOf(question: Question, cellId: string): string[] | null {
  for (const row of question.tableRowsData ?? []) {
    if (!row.cells?.some((cell) => cell.id === cellId)) continue;
    return row.cells.filter((cell) => cell.type === 'input' && !cell.isHidden).map((cell) => cell.id);
  }
  return null;
}

/** 표 셀의 저장 키 — 셀 컴포넌트들이 `option.value ?? option.id` 로 저장한다. */
function cellOptionKey(option: QuestionOption): string {
  return option.value ?? option.id;
}

/** 세부 라벨에서 순위 번호를 읽는다. "1순위", "순위1", "1st" 모두 1. */
function parseRankFromLabel(label: string): number | null {
  const match = label.match(/(\d+)\s*순위|순위\s*(\d+)|^(\d+)$/);
  if (!match) return null;
  const digits = match[1] ?? match[2] ?? match[3];
  const rank = Number(digits);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function findOptionByLabel(
  options: QuestionOption[],
  label: string,
  valueAliases?: Readonly<Record<string, string>>,
): QuestionOption | undefined {
  const key = labelKey(label);
  if (!key) return undefined;
  // 1) 확정 대응이 있으면 그것이 우선한다 — 담당자가 직접 정한 것이다.
  const aliased = valueAliases?.[label.trim()];
  if (aliased) {
    const target = options.find((option) => (option.value ?? option.id) === aliased);
    if (target) return target;
  }
  // 2) 정확 일치
  const exact = options.find((option) => labelKey(option.label) === key);
  if (exact) return exact;
  // 3) 괄호 꼬리를 뗀 접두 일치 — 2026 보기 "기타(직접 입력 : )"·"재학/휴학(고등학교…)" 에
  //    2025 "기타"·"재학/휴학" 을 잇는다. 원본 쪽 꼬리는 떼지 않는다("기타(AI연구 개발)" 은
  //    기타 텍스트 보존 대상이라 여기서 삼키면 안 된다).
  const stem = options.filter((option) => labelStemKey(option.label) === key);
  if (stem.length === 1) return stem[0];
  // 4) 2지 문항의 긍정/부정 동의어 — 보기가 정확히 둘이고 양쪽이 서로 다른 극일 때만.
  if (options.length === 2) {
    const cls = binaryClass(label);
    const classes = options.map((option) => binaryClass(option.label ?? ''));
    if (cls && classes[0] && classes[1] && classes[0] !== classes[1]) {
      return options[classes.indexOf(cls)];
    }
  }
  return undefined;
}

/** 표 칸 라벨 대조 대상 4종 — exportLabel / 행 라벨 / 열 라벨 / 행+열. */
function cellLabelVariants(entry: AnswerableCell): string[] {
  return [entry.cell.exportLabel ?? '', entry.rowLabel, entry.colLabel, `${entry.rowLabel}${entry.colLabel}`];
}

/**
 * 표 칸 라벨의 줄기 키 — 선두 "귀하의" 와 끝의 괄호 꼬리를 뗀다.
 * 2025 "직책"·"업무 분야" ↔ 2026 "귀하의 직책"·"업무 분야 (중복응답)". 다른 존칭·조사는
 * 넣지 않는다 — 실데이터에 그것뿐이다.
 */
function cellLabelStemKey(value: string | null | undefined): string {
  return labelStemKey((value ?? '').replace(/^\s*귀하의\s*/, ''));
}

/**
 * 표 칸 이름끼리의 바이그램 Dice 하한. 4분면 게이트의 LABEL_SIMILAR_THRESHOLD(문항 제목
 * 문장끼리)와 **다른 상수**다 — 짧은 칸 이름은 바이그램이 몇 개 안 돼 같은 값이 맞지 않는다.
 * "입사예정시기" ↔ "입사 시기" 가 정확히 0.5 다.
 */
const TABLE_LABEL_DICE_MIN = 0.5;

/** 세부 라벨 하나의 판정 — 칸이 정해졌거나, 못 정했고(reason 은 후보 여럿에서 멈춘 경우만). */
interface TableCellResolution {
  entry?: AnswerableCell;
  reason?: string;
}

/** 라벨 4종 중 하나라도 조건에 맞는 칸들 — 읽는 순서. */
function cellsWhere(cells: AnswerableCell[], test: (variant: string) => boolean): AnswerableCell[] {
  return cells.filter((entry) => cellLabelVariants(entry).some(test));
}

/**
 * 후보 칸들을 **행 단위**로 접어 하나를 고른다. 후보 행이 유일하면 그 행에서 라벨이 맞은
 * 첫 칸(읽는 순서 — 정확 일치의 find 와 같은 규칙)을 준다. 년·월 행은 두 칸이 다 후보라
 * 첫 칸(년)이 되고, buildBlockAnswer 가 두 칸에 나눠 넣는다. 행의 첫 답 가능 칸이 아니라
 * **맞은** 첫 칸이어야 한다 — 한 행에 이름 붙은 열이 나란한 표(EQ4_1 "지원 받은 시기_년 /
 * 사업명(프로그램명)")에서 행의 첫 칸을 집으면 사업명이 년 칸에 들어간다.
 *
 * 행이 여럿이면 표본값이 그 행 후보 칸의 보기에 맞는지로 가른다. 행의 **어느** 후보 칸이든
 * 맞으면 그 행이고, 맞은 칸이 곧 자리다 — 첫 후보 칸만 보면 라벨이 먼저 맞은 칸이 input 이고
 * 뒤에 radio 가 있는 행은 늘 0 점이 되고, 맞은 칸 대신 첫 칸을 주면 보기에 맞은 값이 input 에
 * 원문으로 들어간다. input 칸은 보기가 없으니 "맞는다" 가 성립하지 않는다. 맞은 행이 정확히
 * 하나일 때만 채택하고, 동률이거나 전부 0 이면 조용히 첫 행을 집지 않고 사유를 남긴다.
 *
 * 사유의 행 나열은 따옴표로 감싸 쉼표로 잇는다 — 마법사가 슬롯들을 ' / ' 로 이어 한 줄에
 * 내므로 같은 구분자를 쓰면 후보 행과 슬롯 경계가 구분되지 않는다.
 */
function pickTableRow(candidates: readonly AnswerableCell[], sampleValue: string): TableCellResolution {
  const byRow = new Map<number, AnswerableCell[]>();
  for (const entry of candidates) {
    const group = byRow.get(entry.rowIndex);
    if (group) group.push(entry);
    else byRow.set(entry.rowIndex, [entry]);
  }
  const rows = [...byRow.values()];
  const soleFirst = rows.length === 1 ? rows[0]?.[0] : undefined;
  if (soleFirst) return { entry: soleFirst };
  const hits = sampleValue
    ? rows
        .map((group) => group.find((entry) => findOptionByLabel(cellOptions(entry.cell), sampleValue)))
        .filter((entry): entry is AnswerableCell => entry !== undefined)
    : [];
  const [hit] = hits;
  if (hits.length === 1 && hit) return { entry: hit };
  const names = rows
    .map((group) => {
      const head = group[0];
      const name = head ? head.rowLabel.trim() || head.cell.exportLabel || head.cell.id : '';
      return `"${name}"`;
    })
    .join(', ');
  const verdict = sampleValue ? `표본값 "${sampleValue}" 으로 못 가름` : '표본값 없음';
  return { reason: `후보 ${rows.length}행(${names}) — ${verdict}` };
}

/**
 * 세부 라벨 하나를 표의 어느 칸에 붙일지 정한다.
 *
 * 정확 일치가 먼저다(읽는 순서 첫 칸). 실패했을 때만 ① 줄기 → ② 접두 → ③ 바이그램 Dice 를
 * 차례로 밟되, **각 단계에서 후보 행이 유일할 때만** 채택한다. 다음 단계로 내려가는 것은 그
 * 단계의 후보가 0개일 때뿐이다 — 후보가 여럿인 단계에서 못 가르면 거기서 미배정으로 끝낸다.
 * 더 느슨한 단계로 내려가면 오배정 확률만 오른다.
 *
 * 2025 rawdata 에서 이 폴백이 살리는 칸: "업무 분야" ↔ "업무 분야 (중복응답)"(①),
 * "직책" ↔ "귀하의 직책"(①), "창업아이템" ⊂ "창업아이템 또는 제품명_값"(②),
 * "담당 직무" ⊂ 두 행(② → 표본값), "입사예정시기" ↔ "입사 시기"(③, 0.5).
 */
function resolveTableCellByLabel(
  cells: AnswerableCell[],
  label: string,
  sampleValue: string,
): TableCellResolution {
  const key = labelKey(label);
  if (!key) return {};

  // 0) 정확 일치 — 읽는 순서 첫 칸. 이 단계는 그대로 두고 후보 수를 세지 않는다.
  const exact = cells.find((entry) => cellLabelVariants(entry).some((variant) => labelKey(variant) === key));
  if (exact) return { entry: exact };

  // ① 줄기 일치 — 양쪽에 같은 줄기 키를 적용해 같으면 후보.
  const stem = cellLabelStemKey(label);
  const byStem = stem ? cellsWhere(cells, (variant) => cellLabelStemKey(variant) === stem) : [];
  if (byStem.length > 0) return pickTableRow(byStem, sampleValue);

  // ② 접두 일치 — 짧은 쪽 키가 2글자 이상일 때만. 한 글자 라벨이 전 칸에 붙는 것을 막는다.
  if (key.length >= 2) {
    const byPrefix = cellsWhere(cells, (variant) => {
      const variantKey = labelKey(variant);
      return variantKey.length >= 2 && (variantKey.startsWith(key) || key.startsWith(variantKey));
    });
    if (byPrefix.length > 0) return pickTableRow(byPrefix, sampleValue);
  }

  // ③ 바이그램 Dice — 라벨 4종 각각의 유사도 중 최대가 칸 점수. 하한 이상인 칸들 중 최고 점수 칸들이 후보다.
  const scored = cells
    .map((entry) => ({
      entry,
      score: Math.max(...cellLabelVariants(entry).map((variant) => labelSimilarity(label, variant))),
    }))
    .filter((item) => item.score >= TABLE_LABEL_DICE_MIN);
  if (scored.length === 0) return {};
  const top = Math.max(...scored.map((item) => item.score));
  return pickTableRow(scored.filter((item) => item.score === top).map((item) => item.entry), sampleValue);
}

/**
 * 블록 컬럼들이 이 문항의 어느 자리인지 정한다.
 *
 * 자동 제안과 **사람이 화면에서 고른 문항** 이 같은 규칙을 쓰게 하려고 내보낸다 —
 * 제안 경로로만 자리를 정하면 코드가 다른 문항을 고른 순간 전 칸이 미배정이 된다.
 */
export function resolveSlots(
  question: Question,
  block: HeaderBlock,
  /**
   * 블록 컬럼별 데이터 표본 값(첫 비어 있지 않은 값). 복수응답 펼침은 세부 라벨 행이
   * 비어 있고 **값 자체가 보기 라벨**인 파일이 흔하다(2025 DQ5-2: 라벨 없음, 값 "인건비(…)").
   * 세부 라벨이 비면 이 값으로 보기를 정한다. 표 문항에서는 세부 라벨의 후보 행이 여럿일 때
   * 어느 행의 보기에 맞는지로 가르는 근거다.
   */
  sampleValues?: readonly string[],
): BlockSlot[] {
  const count = block.columnIndexes.length;

  if (question.type === 'table') {
    const cells = collectAnswerableCells(question);
    const byLabel = block.detailLabels.map((label, idx) =>
      resolveTableCellByLabel(cells, label, sampleValues?.[idx] ?? ''),
    );
    // 읽는 순서로 채우는 폴백은 **세부 라벨이 전부 비어 있을 때만** 쓴다. 라벨이 있는데
    // 안 맞는 경우까지 순서로 덮으면, 열 순서가 바뀐 표(2025 명→기관→공개유무→구분 vs
    // 2026 명→구분→진행상태→기관)에서 값이 조용히 엇갈려 들어간다 — 그건 unmatched 로
    // 남겨 담당자가 칸 배정에서 보게 하는 편이 낫다.
    const allMatched = byLabel.every((found) => found.entry !== undefined);
    const allBlank = block.detailLabels.every((label) => !labelKey(label));
    if (!allMatched && allBlank && cells.length === count) {
      return cells.map((entry) => ({
        kind: 'table-cell' as const,
        cellId: entry.cell.id,
        cellType: entry.cell.type,
      }));
    }
    return byLabel.map((found): BlockSlot => {
      if (found.entry) {
        return { kind: 'table-cell', cellId: found.entry.cell.id, cellType: found.entry.cell.type };
      }
      return found.reason ? { kind: 'unmatched', reason: found.reason } : { kind: 'unmatched' };
    });
  }

  if (question.type === 'checkbox') {
    const options = resolveChoiceOptions(question);
    return block.detailLabels.map((label, idx) => {
      // 세부 라벨로 먼저 찾고, 안 맞으면 그 열에 실제로 들어 있는 값으로 찾는다.
      // 펼침의 첫 열은 세부 라벨이 보기가 아니라 문항 설명("지원분야(복수응답)")인 파일이
      // 흔하다 — 라벨이 있다고 값 폴백을 막으면 그 열만 빠진다.
      const option =
        findOptionByLabel(options, label) ?? findOptionByLabel(options, sampleValues?.[idx] ?? '');
      return option
        ? { kind: 'checkbox-option' as const, optionValue: option.value }
        : { kind: 'unmatched' as const };
    });
  }

  if (question.type === 'ranking') {
    return block.detailLabels.map((label, idx) => {
      const rank = parseRankFromLabel(label) ?? idx + 1;
      return { kind: 'ranking-rank' as const, rank };
    });
  }

  // 단일 컬럼 문항 — 블록이 한 칸이고 그 유형이 한 칸으로 정해질 때만 자리를 준다.
  const single = count === 1 && SINGLE_CELL_TYPES.has(question.type);
  return block.columnIndexes.map((_, idx) =>
    single && idx === 0 ? { kind: 'single' as const } : { kind: 'unmatched' as const },
  );
}

/** 표 칸 중 보기가 있는 셀 타입 — 적합도의 분모에 드는 칸. input 칸은 보기가 없어 "맞는다" 가 성립하지 않는다. */
const CHOICE_CELL_TYPES = new Set<TableCell['type']>(['radio', 'checkbox', 'select']);

/**
 * 블록의 실제 값이 이 문항의 보기와 얼마나 맞는가.
 *
 * `null` 은 "판정 대상 아님" 이다 — 계산하지 않았으니 판정을 바꾸지 않는다. 자유입력·숫자
 * 문항, 표본이 없거나 3건 미만인 블록, single 슬롯이 없는 radio 블록(3칸 → radio, EQ1-1.)이
 * 그것이다. 마지막 것은 이미 unsupportedQuestionIds 로 드러나는 블록이라 판정을 덧씌우지 않는다.
 *
 * 유형별 분자/분모:
 * - radio/select: single 슬롯 열의 값 분포 전부 — 보기에 맞는 건수 / 전체 건수
 * - checkbox: 값이 보기 라벨인 파일과 선택 표기(`1`/`O`)인 파일이 둘 다 있어 값이 아니라 **슬롯** 을
 *   본다 — 표본이 있는 열 중 checkbox-option 으로 배정된 열 수 / 표본이 있는 열 수
 * - ranking: ranking-rank 슬롯 열의 값 — 순위 보기에 맞는 건수
 * - table: table-cell 슬롯 중 보기가 있는 칸만 — 그 칸의 보기에 맞는 건수. input·unmatched 칸은 분모에도 없다
 */
export function sampleFit(
  question: Question,
  block: HeaderBlock,
  slots: readonly BlockSlot[],
  options: SuggestOptions,
): SampleFit | null {
  const countsByColumn = options.valueCountsByColumn;
  if (!countsByColumn) return null;
  const aliases = options.valueAliases?.[question.id];
  const countsAt = (idx: number): ReadonlyArray<ColumnValueCount> => {
    const col = block.columnIndexes[idx];
    return col === undefined ? [] : (countsByColumn.get(col) ?? []);
  };
  const fit: SampleFit = { matched: 0, total: 0 };
  const tally = (idx: number, choices: QuestionOption[]) => {
    for (const { value, count } of countsAt(idx)) {
      fit.total += count;
      if (findOptionByLabel(choices, value, aliases)) fit.matched += count;
    }
  };

  switch (question.type) {
    case 'radio':
    case 'select': {
      const idx = slots.findIndex((slot) => slot.kind === 'single');
      if (idx === -1) return null;
      tally(idx, resolveChoiceOptions(question));
      break;
    }
    case 'checkbox': {
      slots.forEach((slot, idx) => {
        if (countsAt(idx).length === 0) return;
        fit.total += 1;
        if (slot.kind === 'checkbox-option') fit.matched += 1;
      });
      break;
    }
    case 'ranking': {
      const choices = resolveRankingOptions(question);
      slots.forEach((slot, idx) => {
        if (slot.kind === 'ranking-rank') tally(idx, choices);
      });
      break;
    }
    case 'table': {
      const cellById = new Map(collectAnswerableCells(question).map((entry) => [entry.cell.id, entry.cell]));
      slots.forEach((slot, idx) => {
        if (slot.kind !== 'table-cell' || !CHOICE_CELL_TYPES.has(slot.cellType)) return;
        const cell = cellById.get(slot.cellId);
        if (cell) tally(idx, cellOptions(cell));
      });
      break;
    }
    default:
      return null;
  }
  return fit.total < VALUE_FIT_MIN_SAMPLES ? null : fit;
}

function fitRatio(fit: SampleFit): number {
  return fit.total > 0 ? fit.matched / fit.total : 0;
}

/** 사유에 넣는 문항 표기 — 제목 앞 30자. 실무 문항 제목은 코드로 시작해 코드가 함께 보인다. */
function questionMention(question: Question): string {
  const title = question.title.replace(/\s+/g, ' ').trim();
  const short = title.length > 30 ? `${title.slice(0, 30)}…` : title;
  return short || question.questionCode || question.id;
}

/** 코드 일치 문항의 적합도 사유 — 건수와 대상 문항. */
function codeFitReason(fit: SampleFit, question: Question): string {
  return `표본 ${fit.total}건 중 보기와 맞는 값 ${fit.matched}건 (${questionMention(question)})`;
}

/** 값 후보 문항의 적합도 사유. */
function candidateFitReason(fit: SampleFit): string {
  return `제안 문항 보기와 맞는 값 ${fit.matched}건 / 표본 ${fit.total}건 (${Math.round(fitRatio(fit) * 100)}%)`;
}

/** 후보가 여럿인데 못 가른 사유 — 담당자가 그 목록에서 직접 고른다. */
function ambiguousReason(candidates: readonly Question[]): string {
  const codes = candidates.map((question) => question.questionCode || questionMention(question)).join(', ');
  return `값이 맞는 문항 ${candidates.length}개: ${codes} — 제목으로 못 가름`;
}

interface ValueCandidate {
  question: Question;
  fit: SampleFit;
  /** 후보 여럿을 제목 유사도로 갈랐는가 — 약한 신호라 사유에 남긴다. */
  decidedByTitle: boolean;
}

interface ValueCandidateSearch {
  pick?: ValueCandidate;
  /** 적합도는 넘었지만 제목으로 못 가른 후보들. pick 이 있으면 비어 있다. */
  ambiguous: Question[];
}

/**
 * 블록 값이 보기와 맞는 다른 문항을 찾는다 — **한 칸 블록 → radio/select** 만.
 *
 * 실제 사례(HQ1·AQ1-1·AQ1-2·IQ1)가 전부 그것이고, 표·복수응답·순위끼리의 값 대조는 범위 밖이다.
 * 적합도 VALUE_FIT_CANDIDATE_MIN 이상인 문항이 정확히 하나면 그것, 여럿이면 블록 라벨과 제목의
 * 유사도가 **유일하게 최고이고 0 보다 클 때만** 그것이다. 2지 문항은 긍정/부정 동의어로 서로
 * 100% 가 나오기 때문이다 — 2025 IQ1.(있음/없음) 은 미매핑 2지 문항 넷에 전부 맞았고, 라벨
 * `창업의향` 과의 제목 유사도(HQ1 0.167, 나머지 0)로만 갈렸다.
 */
function findValueCandidate(
  block: HeaderBlock,
  candidates: readonly Question[],
  options: SuggestOptions,
): ValueCandidateSearch {
  if (block.columnIndexes.length !== 1 || !options.valueCountsByColumn) return { ambiguous: [] };
  const single: BlockSlot[] = [{ kind: 'single' }];
  const hits = candidates.flatMap((question) => {
    if (question.type !== 'radio' && question.type !== 'select') return [];
    const fit = sampleFit(question, block, single, options);
    if (!fit || fitRatio(fit) < VALUE_FIT_CANDIDATE_MIN) return [];
    return [{ question, fit }];
  });
  const [sole] = hits;
  if (hits.length === 0 || !sole) return { ambiguous: [] };
  if (hits.length === 1) return { pick: { ...sole, decidedByTitle: false }, ambiguous: [] };
  const scored = hits.map((hit) => ({ ...hit, score: labelSimilarity(block.label, hit.question.title) }));
  const top = Math.max(...scored.map((hit) => hit.score));
  const winners = scored.filter((hit) => hit.score === top);
  const [winner] = winners;
  if (top > 0 && winners.length === 1 && winner) {
    return { pick: { question: winner.question, fit: winner.fit, decidedByTitle: true }, ambiguous: [] };
  }
  return { ambiguous: hits.map((hit) => hit.question) };
}

/** 후보 여럿을 제목 유사도로 가른 사실 — 약한 신호라 사유 꼬리에 남긴다. 두 분기가 같은 문구를 쓴다. */
function decidedByTitleTail(pick: ValueCandidate): string {
  return pick.decidedByTitle ? ' — 값이 맞는 문항 여럿 중 제목이 가장 비슷한 것' : '';
}

/** 코드 일치 문항이 auto 로 붙기를 막는 적합도인가 — 판정 대상이 아니면(null) 막지 않는다. */
function codeFitRejects(fit: SampleFit | null): fit is SampleFit {
  return fit !== null && fitRatio(fit) < VALUE_FIT_CONFLICT_BELOW;
}

/**
 * 블록의 코드 일치 문항과 그 문항에 대한 두 게이트(라벨·적합도) 결과.
 *
 * `taken` 과 무관하게 정해지므로 처리 전에 블록마다 한 번 계산해 두 곳에서 쓴다 — 코드 분기 판정과,
 * 앞 블록의 값 후보 검색에서 **뒤 블록 몫을 빼는 것**.
 */
type CodeAssessment =
  | { question: Question; similar: false }
  | { question: Question; similar: true; slots: BlockSlot[]; fit: SampleFit | null };

/** 이 블록이 코드 일치 문항을 auto 로 잡는가 — 라벨 게이트와 적합도 게이트를 다 통과할 때. */
function holdsByCode(assessment: CodeAssessment | null): assessment is CodeAssessment {
  return assessment !== null && assessment.similar && !codeFitRejects(assessment.fit);
}

/**
 * 블록과 문항을 잇는 자동 제안.
 *
 * 문항코드 정규화 대조로 문항을 정하고, 블록 컬럼들이 그 문항의 어느 자리인지까지
 * 한 번에 정한다 — 표 아홉 칸을 사람이 아홉 번 확정하지 않게 하는 것이 이 티켓의 요지다.
 *
 * 코드가 맞아도 **표본값 적합도** 를 한 겹 더 건다(options.valueCountsByColumn 이 있을 때만).
 * 블록은 헤더 순서로 처리되고 `taken` 이 greedy 라, 값 후보로 제안된 문항은 뒤 블록이 못 가져간다.
 * 그 반대 방향은 막는다 — 뒤 블록이 코드로 잡을 문항(두 게이트 통과)은 앞 블록의 값 후보 풀에서 뺀다.
 * 2지 문항은 긍정/부정 동의어로 서로 100% 라, 이것이 없으면 2026 에 없는 코드 블록 하나가 뒤의 정확
 * 일치 문항을 제목 바이그램 하나로 가져가 정확 일치 블록이 unmapped 로 밀린다.
 */
export function suggestBlockMapping(
  blocks: readonly HeaderBlock[],
  questions: readonly Question[],
  /** 컬럼 인덱스 → 데이터 표본 값. resolveSlots 의 sampleValues 근거. */
  sampleByColumn?: ReadonlyMap<number, string>,
  options: SuggestOptions = {},
): BlockSuggestion[] {
  const samplesFor = (block: HeaderBlock) =>
    sampleByColumn ? block.columnIndexes.map((col) => sampleByColumn.get(col) ?? '') : undefined;
  const byCode = new Map<string, Question>();
  for (const question of questions) {
    // 보기 그룹이 있는 문항은 저장형이 { groupKey: 값 } 객체라 블록 단위로도 만들 수 없다.
    if (isGroupedChoiceQuestion(question)) continue;
    const code = normalizeQuestionCode(question.questionCode);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, question);
  }

  const eligible = questions.filter((question) => !isGroupedChoiceQuestion(question));
  const taken = new Set<string>();
  const unmatchedSlots = (block: HeaderBlock): BlockSlot[] =>
    block.columnIndexes.map(() => ({ kind: 'unmatched' as const }));

  const assessCode = (block: HeaderBlock): CodeAssessment | null => {
    // 실무 헤더는 `BQ1-1. 창업 기업명` 처럼 코드와 라벨이 한 칸에 붙어 있다 —
    // 전체와 선두 토큰을 둘 다 후보로 본다.
    const question = headerCodeCandidates(block.codeText)
      .map((code) => byCode.get(code))
      .find((found) => found !== undefined);
    if (!question) return null;
    // 대조할 문항 내용이 없으면 코드 일치만으로 간다 — 라벨 없는 파일에서 코드 일치를
    // 경고로 뒤집으면 매핑이 전부 막힌다. 세부 라벨 유래 텍스트도 "내용 없음"으로 본다
    // (labelSource 참조). 코드가 밀린 사고는 미리보기의 변환 실패율 100% 로 드러난다.
    const comparable = block.labelSource === 'code' && block.label;
    const similar =
      !comparable || labelSimilarity(block.label, question.title) >= LABEL_SIMILAR_THRESHOLD;
    if (!similar) return { question, similar: false };
    const slots = resolveSlots(question, block, samplesFor(block));
    return { question, similar: true, slots, fit: sampleFit(question, block, slots, options) };
  };
  const assessments = blocks.map(assessCode);

  // 1패스 — 아직 처리하지 않은 블록이 코드로 잡을 문항을 센다. 블록 순서대로 자기 몫을 빼며 내려가므로
  // 어느 시점에든 "뒤 블록 몫" 만 남는다. 뒤 블록의 값이 그 문항에 안 맞으면(적합도 게이트 탈락) 몫이
  // 아니다 — 2025 AQ1-2. 의 AQ1_2 적합도가 0% 라 앞 블록 AQ1-1. 이 AQ1_2 를 제안받는 것이 그 덕이다.
  const pendingCodeHolds = new Map<string, number>();
  const adjustHold = (assessment: CodeAssessment | null, delta: number) => {
    if (!holdsByCode(assessment)) return;
    const id = assessment.question.id;
    pendingCodeHolds.set(id, (pendingCodeHolds.get(id) ?? 0) + delta);
  };
  for (const assessment of assessments) adjustHold(assessment, 1);
  const reservedByLaterBlock = (question: Question) => (pendingCodeHolds.get(question.id) ?? 0) > 0;
  /** 값 후보 검색 풀 — 미매핑이고, 코드 문항이 아니고, 뒤 블록 몫이 아닌 것. */
  const valueCandidatePool = (exclude?: Question) =>
    eligible.filter(
      (question) =>
        !taken.has(question.id) && question.id !== exclude?.id && !reservedByLaterBlock(question),
    );

  return blocks.map((block, index): BlockSuggestion => {
    const assessment = assessments[index] ?? null;
    adjustHold(assessment, -1);

    if (assessment && !taken.has(assessment.question.id)) {
      const byCodeMatch = assessment.question;
      if (!assessment.similar) {
        return {
          block,
          questionId: null,
          matchedBy: null,
          verdict: 'code-conflict',
          conflictQuestionId: byCodeMatch.id,
          slots: unmatchedSlots(block),
        };
      }

      const { slots, fit } = assessment;
      if (!codeFitRejects(fit)) {
        taken.add(byCodeMatch.id);
        return { block, questionId: byCodeMatch.id, matchedBy: 'code', verdict: 'auto', slots };
      }

      // 코드는 맞는데 값이 그 문항의 보기와 맞지 않는다. 값이 맞는 다른 문항이 하나면 그것을
      // 제안하고, 아니면 멈춘다. 어느 쪽에서도 코드 문항은 `taken` 에 넣지 않는다 — 뒤 블록이
      // 그 문항을 제안받아야 한다(2025 IQ1. → HQ1, AQ1-2. → AQ1_1).
      const reason = codeFitReason(fit, byCodeMatch);
      const search = findValueCandidate(block, valueCandidatePool(byCodeMatch), options);
      if (search.pick) {
        taken.add(search.pick.question.id);
        return {
          block,
          questionId: search.pick.question.id,
          matchedBy: 'value',
          verdict: 'label-candidate',
          conflictQuestionId: byCodeMatch.id,
          verdictReason: `${reason} — ${candidateFitReason(search.pick.fit)}${decidedByTitleTail(search.pick)}`,
          slots: resolveSlots(search.pick.question, block, samplesFor(block)),
        };
      }
      return {
        block,
        questionId: null,
        matchedBy: null,
        verdict: 'value-conflict',
        conflictQuestionId: byCodeMatch.id,
        verdictReason:
          search.ambiguous.length > 0 ? `${reason} — ${ambiguousReason(search.ambiguous)}` : reason,
        slots: unmatchedSlots(block),
      };
    }

    // 코드가 다르다 — 문항 내용이 같으면 후보로 올린다(파트 재편으로 코드가 밀린 경우).
    if (block.label) {
      const byLabel = eligible
        .filter((question) => !taken.has(question.id))
        .map((question) => ({
          question,
          score: labelSimilarity(block.label, question.title),
        }))
        .filter((entry) => entry.score >= LABEL_SIMILAR_THRESHOLD)
        .sort((a, b) => b.score - a.score)[0];
      if (byLabel) {
        taken.add(byLabel.question.id);
        return {
          block,
          questionId: byLabel.question.id,
          matchedBy: 'label',
          verdict: 'label-candidate',
          slots: resolveSlots(byLabel.question, block, samplesFor(block)),
        };
      }
    }

    // 코드로도 제목으로도 못 이었다 — 값이 어느 문항의 보기와 맞는지로 한 번 더 찾는다.
    // 문항코드 꼴의 블록만이다(2026 에 없는 코드 IQ1., 이미 가져간 코드 AQ1-2.) — 명단 메타 열은 제외.
    const search: ValueCandidateSearch = looksLikeQuestionCode(block.code)
      ? findValueCandidate(block, valueCandidatePool(), options)
      : { ambiguous: [] };
    if (search.pick) {
      taken.add(search.pick.question.id);
      return {
        block,
        questionId: search.pick.question.id,
        matchedBy: 'value',
        verdict: 'label-candidate',
        verdictReason: `${candidateFitReason(search.pick.fit)}${decidedByTitleTail(search.pick)}`,
        slots: resolveSlots(search.pick.question, block, samplesFor(block)),
      };
    }

    return {
      block,
      questionId: null,
      matchedBy: null,
      verdict: 'unmapped',
      ...(search.ambiguous.length > 0 ? { verdictReason: ambiguousReason(search.ambiguous) } : {}),
      slots: unmatchedSlots(block),
    };
  });
}

/** 복수응답 펼침에서 "선택 안 함"으로 읽는 표기. */
const NOT_SELECTED = new Set(['0', 'n', 'no', 'false', '아니오', '아니요', '미선택', '비선택', '해당없음', '없음']);

function isSelectedMark(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  return !NOT_SELECTED.has(value.toLowerCase());
}

export interface BlockAnswer {
  /** 저장할 값. 살아남은 값이 없으면 undefined — 빈 묶음으로 지난 회차 값을 덮지 않는다. */
  value: unknown;
  /** 어느 선택지·순위 보기에도 맞지 않아 버린 원본 값. 담당자에게 그대로 보여준다. */
  unmatchedValues: string[];
  /** 선택지 대조를 시도한 칸 수 — 실패 비율의 분모. */
  convertedCells: number;
}

/**
 * 블록의 셀 값들을 이 문항의 저장 형태 한 벌로 만든다.
 *
 * 블록 안에 빈 칸이 섞여 있어도 나머지 칸은 그대로 저장된다.
 *
 * @param cellValues block.columnIndexes 와 같은 순서·길이의 셀 텍스트
 */
export function buildBlockAnswer(
  question: Question,
  slots: readonly BlockSlot[],
  cellValues: readonly string[],
  /**
   * 확정된 값 대응 — 원본 값 → 선택지 저장값. 선택지 라벨이 지난 회차와 달라진 문항에서
   * 담당자가 화면에서 이어준 것이며, 다시 올릴 때 그대로 재사용된다.
   */
  valueAliases?: Readonly<Record<string, string>>,
): BlockAnswer {
  const unmatchedValues: string[] = [];
  let convertedCells = 0;

  if (question.type === 'table') {
    const cellById = new Map(
      collectAnswerableCells(question).map((entry) => [entry.cell.id, entry.cell]),
    );
    const answer: Record<string, unknown> = {};
    slots.forEach((slot, idx) => {
      if (slot.kind !== 'table-cell') return;
      const raw = cleanCell(cellValues[idx]);
      if (!raw) return;
      // 입력 칸은 원문 그대로. 선택 칸은 라벨 텍스트를 저장 키로 바꾼다 —
      // 라벨을 그대로 넣으면 화면에서 빈칸으로 보이는데 이월 값은 있는 것으로 판정돼,
      // "같음" 이 그 오염값을 올해 응답으로 복사한다.
      if (slot.cellType === 'input') {
        // "2025년 1월"·"25년 5월" 이 년 칸에 통째로 들어가는 것을 막는다 — 같은 행에 input 셀이
        // 정확히 둘(년·월)이고 값이 년월 꼴이면 두 칸에 나눠 넣는다. 그 외는 원문 그대로.
        const split = splitYearMonth(raw);
        const rowInputs = split ? inputCellsInRowOf(question, slot.cellId) : null;
        if (split && rowInputs && rowInputs.length === 2) {
          answer[rowInputs[0]!] = split.year;
          answer[rowInputs[1]!] = split.month;
          return;
        }
        answer[slot.cellId] = raw;
        return;
      }
      const cell = cellById.get(slot.cellId);
      const options = cell ? cellOptions(cell) : [];
      convertedCells += 1;
      const option = findOptionByLabel(options, raw, valueAliases);
      if (!option) {
        unmatchedValues.push(raw);
        return;
      }
      answer[slot.cellId] =
        slot.cellType === 'checkbox' ? [cellOptionKey(option)] : cellOptionKey(option);
    });
    const value = Object.keys(answer).length > 0 ? answer : undefined;
    return { value, unmatchedValues, convertedCells };
  }

  if (question.type === 'checkbox') {
    const selected: string[] = [];
    slots.forEach((slot, idx) => {
      if (slot.kind !== 'checkbox-option') return;
      if (!isSelectedMark(cleanCell(cellValues[idx]))) return;
      selected.push(slot.optionValue);
    });
    return {
      value: selected.length > 0 ? selected : undefined,
      unmatchedValues,
      convertedCells,
    };
  }

  if (question.type === 'ranking') {
    const options = resolveRankingOptions(question);
    const answers: Array<{ rank: number; optionValue: string }> = [];
    slots.forEach((slot, idx) => {
      if (slot.kind !== 'ranking-rank') return;
      const raw = cleanCell(cellValues[idx]);
      if (!raw) return;
      convertedCells += 1;
      const option = findOptionByLabel(options, raw, valueAliases);
      if (!option) {
        unmatchedValues.push(raw);
        return;
      }
      answers.push({ rank: slot.rank, optionValue: option.value });
    });
    return {
      value: answers.length > 0 ? answers.sort((a, b) => a.rank - b.rank) : undefined,
      unmatchedValues,
      convertedCells,
    };
  }

  const singleIndex = slots.findIndex((slot) => slot.kind === 'single');
  if (singleIndex === -1) return { value: undefined, unmatchedValues, convertedCells };
  // 한 칸으로 값이 정해지지 않는 유형(다단계선택 배열·안내문 동의 객체 등)은 만들지 않는다.
  if (!SINGLE_CELL_TYPES.has(question.type)) {
    return { value: undefined, unmatchedValues, convertedCells };
  }
  const raw = cleanCell(cellValues[singleIndex]);
  if (!raw) return { value: undefined, unmatchedValues, convertedCells };

  // 선택지 문항은 엑셀의 라벨 텍스트를 저장값으로 바꾼다. 맞지 않으면 그 문항만 비운다.
  if (question.type === 'radio' || question.type === 'select') {
    convertedCells += 1;
    const option = findOptionByLabel(resolveChoiceOptions(question), raw, valueAliases);
    if (!option) {
      unmatchedValues.push(raw);
      return { value: undefined, unmatchedValues, convertedCells };
    }
    return { value: option.value, unmatchedValues, convertedCells };
  }

  return { value: raw, unmatchedValues, convertedCells };
}

/** 열당 보존하는 distinct 값 상한. 실측 최대는 주소지 71·창업아이템 44 — 자유입력 열이 수천 건으로 불어나는 것만 막는다. */
const MAX_DISTINCT_VALUES_PER_COLUMN = 200;

/**
 * 데이터 행에서 컬럼별 값 분포를 뽑는다 — cleanCell 적용, 건수 내림차순(동률은 먼저 나온 값).
 * 표본값 적합도(sampleFit)의 근거이며, collectSampleValues 의 최빈값도 이것의 첫 항목이다.
 */
export function collectColumnValueCounts(
  rows: ReadonlyArray<readonly string[]>,
): Map<number, ColumnValueCount[]> {
  const counts = new Map<number, Map<string, number>>();
  for (const row of rows) {
    row.forEach((value, col) => {
      const cleaned = cleanCell(value);
      if (!cleaned) return;
      const perColumn = counts.get(col) ?? new Map<string, number>();
      perColumn.set(cleaned, (perColumn.get(cleaned) ?? 0) + 1);
      counts.set(col, perColumn);
    });
  }
  const result = new Map<number, ColumnValueCount[]>();
  for (const [col, perColumn] of counts) {
    result.set(
      col,
      [...perColumn.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_DISTINCT_VALUES_PER_COLUMN),
    );
  }
  return result;
}

/**
 * 데이터 행에서 컬럼별 표본 값을 뽑는다 — 각 컬럼의 **최빈값**.
 * 복수응답 펼침처럼 세부 라벨이 없는 블록의 보기를 정하는 데 쓴다. 첫 값이 아니라 최빈값인
 * 이유: 펼침 열은 정상 값이 한 종류뿐이라 최빈값이 곧 보기 라벨이고, 첫 행에 낀 오타·오류
 * 표식 한 건에 흔들리지 않는다.
 */
export function collectSampleValues(rows: ReadonlyArray<readonly string[]>): Map<number, string> {
  const samples = new Map<number, string>();
  for (const [col, values] of collectColumnValueCounts(rows)) {
    const top = values[0];
    if (top) samples.set(col, top.value);
  }
  return samples;
}
