import ExcelJS from 'exceljs';

import { HEADER_BORDER, HEADER_FILL, HEADER_FONT } from '@/lib/analytics/export-styles';
import { columnCellLabel } from '@/lib/analytics/column-cell-label';
import { buildCodebookValueLabel, formatExcelDateTime } from '@/lib/analytics/raw-export-helpers';
import {
  type SPSSExportColumn,
  type SpssColumnOptions,
  buildDataRow,
  generateSPSSColumns,
} from '@/lib/analytics/spss-excel-export';
import { collectUsedRepeatCounts } from '@/lib/analytics/row-repeat-usage';
import type { RawExportContactColumn } from '@/lib/operations/contacts-format';
import { type Platform, formatPlatformKo } from '@/lib/operations/parse-ua';
import {
  NOT_RESPONDED_STATUS,
  formatExportStatusLabel,
  formatTotalTime,
} from '@/lib/operations/profiles-format';
import { buildCodebookVariableMetadata } from '@/lib/spss/export-metadata';
import { buildMrsetNameMap } from '@/lib/spss/mrsets-syntax';
import { buildLabel } from '@/lib/spss/variable-meta';
import { buildInviteUrl } from '@/lib/survey-url';
import type { ContactResultCode } from '@/shared/contracts/contacts';
import { Question, SurveySubmission } from '@/types/survey';
import type { SurveyLocale } from '@/types/survey-locale';

// ============================================================
// Raw Data 워크북
// ============================================================

export interface RawExportResponseRow {
  /** 응답 id. 미응답 행은 contact_targets.id (파일 안에서 유일 — 미응답 대상은 응답 행이 없다) */
  id: string;
  /** 미응답 행은 {} */
  questionResponses: Record<string, unknown>;
  resid: number | null;
  inviteCode: string | null;
  ipHash: string | null;
  currentStepId: string | null;
  platform: string | null;
  browser: string | null;
  /** survey_responses.status 또는 NOT_RESPONDED_STATUS */
  status: string;
  /** 미응답 행은 null */
  startedAt: Date | null;
  completedAt: Date | null;
  totalSeconds: number | null;
  /** 조사 대상의 마지막 회차 결과코드(코드 글자 그대로). 조사 대상이 없거나 회차가 없으면 null·없음 */
  resultCode?: string | null;
  /**
   * 손으로 고친 명단 열 — source('attrs.기업명' / 'pii.대표번호'). 대상 정보 수정 현황 기록에서
   * 온다. 이 열의 칸은 노랗게 칠한다. 고친 열이 없으면 키가 없다.
   */
  editedSources?: ReadonlySet<string>;
  /**
   * 조사 대상 명단 열 값 — source → 값 (RawExportContext.contactColumns 의 source 와 같은 키).
   * 조사 대상이 없는 익명 응답은 키 자체가 없고, 컨택은 있으나 값이 없는 키는 ''.
   */
  contactValues?: Readonly<Record<string, string>>;
  /**
   * 이어 넘길 값 — 응답자가 들어온 링크의 패널 회원 ID 등(metadata.entryParams). 이름 → 값.
   * 남긴 값이 없는 응답·미응답 행은 키가 없다.
   */
  entryParams?: Readonly<Record<string, string>>;
}

/** 미응답 조사 대상 행 — 응답이 아니므로 응답 메타(단말·소요시간 등)를 빈칸으로 그린다. */
export function isNonRespondentRow(row: Pick<RawExportResponseRow, 'status'>): boolean {
  return row.status === NOT_RESPONDED_STATUS;
}

export interface RawExportContext {
  /** NEXT_PUBLIC_APP_URL 정리값 (trailing slash 제거). 미설정 시 '' — 상대경로 /i/{code} 출력 */
  appUrl: string;
  /** currentStepId → 표시 라벨 (buildStepLabelMap 결과) */
  stepLabels: ReadonlyMap<string, string>;
  /** 설문에 컨택 타겟이 존재하는지 — false 면 결과코드 열을 만들지 않는다 (응답 매칭 여부 무관, 설문 설정 기준) */
  hasContacts: boolean;
  /**
   * 설문의 결과코드 목록(기본값 폴백 포함) — 결과코드 열의 숫자와 코딩북 값 라벨을 만든다.
   * 없으면 코드 글자의 앞 번호만 읽는다.
   */
  resultCodes?: readonly ContactResultCode[];
  /**
   * 질문 id → { order, 표시 라벨 } (buildQuestionMetaMap 결과).
   * currentStepId 미저장 구응답의 "마지막 입력 문항" 폴백 — 응답값이 존재하는 질문 중 최후순의 라벨.
   */
  questionMeta: ReadonlyMap<string, { order: number; label: string }>;
  /**
   * 변동 확인 변수를 붙일 문항 id (추적조사). 이월 응답이 없는 설문에서는 비어 있고,
   * 그때 컬럼 출력은 이 기능 도입 전과 완전히 같다.
   */
  changeConfirmQuestionIds?: ReadonlySet<string>;
  /**
   * 조사 대상 명단 열 — 응답 내역 컬럼 설정에서 표시 중인 attrs·pii 열. IP 해시와 개별 URL 사이에
   * 들어간다. 비어 있거나 없으면 명단 열이 없는 열 구성이다.
   */
  contactColumns?: readonly RawExportContactColumn[];
  /**
   * 이어 넘길 값의 이름(종료 후 이동 주소 설정의 passParams) — 명단 열 다음·개별 URL 앞에
   * 이름 그대로 한 열씩 붙는다. 비어 있거나 없으면 열이 없다.
   */
  entryParamNames?: readonly string[];
  /**
   * 반복 블록별 "실제로 쓰인 최대 벌" — 뒤쪽 미사용 벌의 열을 빼는 판정.
   * 워크북 빌더가 진입부에서 모수 전체를 1회 스캔해 채운다(withUsedRepeatCounts).
   * 모든 시트가 같은 맵을 공유해야 파일 안에서 열 구성이 갈리지 않는다.
   */
  usedRepeatCounts?: ReadonlyMap<string, number>;
  /**
   * 문항 id → 언어 묶음의 언어 (`resolveLanguageSetLocales`). 공유 변수명을 한 열로 합친다
   * (CONTEXT.md 「공유 변수명」). 다국어 설문이 아니면 비어 있거나 없고, 열 구성은 그대로다.
   */
  languageSetLocales?: ReadonlyMap<string, SurveyLocale>;
}

/**
 * 워크북 컨텍스트에서 컬럼 생성 옵션을 뽑는다.
 * 호출부마다 조건부 spread 를 반복하면 옵션이 하나 늘 때마다 드리프트가 생긴다.
 */
export function toSpssColumnOptions(ctx: RawExportContext): SpssColumnOptions {
  return {
    ...(ctx.changeConfirmQuestionIds
      ? { changeConfirmQuestionIds: ctx.changeConfirmQuestionIds }
      : {}),
    ...(ctx.usedRepeatCounts ? { usedRepeatCounts: ctx.usedRepeatCounts } : {}),
    ...(ctx.languageSetLocales ? { languageSetLocales: ctx.languageSetLocales } : {}),
  };
}

/**
 * 반복 블록 사용 벌 스캔을 컨텍스트에 얹는다 — 워크북 빌더 진입부에서 한 번만 부른다.
 * 파일별이 아니라 **모수 전체**를 세야 분할 내보내기의 파일 간 열 구성이 같다.
 */
export function withUsedRepeatCounts(
  ctx: RawExportContext,
  questions: Question[],
  rows: readonly RawExportResponseRow[],
): RawExportContext {
  const usedRepeatCounts = collectUsedRepeatCounts(questions, rows);
  return usedRepeatCounts.size > 0 ? { ...ctx, usedRepeatCounts } : ctx;
}

/** 응답값이 실제 입력으로 간주되는지 — 빈 문자열/빈 배열/빈 객체는 미입력. */
function isAnsweredValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * "마지막 입력 문항" 라벨 해석 — 이름 그대로 "마지막으로 입력한 문항" 기준.
 * 1순위: 응답값이 실제 존재하는 질문 중 order 최후순 질문의 라벨.
 *        (진행 페이지 대표가 아니라 입력 기준 — 한 페이지에 여러 문항이 있어도 정확)
 * 폴백: 응답이 전혀 없으면 진행 위치(currentStepId) 페이지 라벨(도달 위치라도 표시).
 * 둘 다 없으면 공백.
 */
export function resolveLastEnteredLabel(row: RawExportResponseRow, ctx: RawExportContext): string {
  let best: { order: number; label: string } | null = null;
  for (const [questionId, value] of Object.entries(row.questionResponses)) {
    if (!isAnsweredValue(value)) continue;
    const meta = ctx.questionMeta.get(questionId);
    if (!meta || !meta.label) continue;
    if (!best || meta.order > best.order) best = meta;
  }
  if (best) return best.label;

  return row.currentStepId ? (ctx.stepLabels.get(row.currentStepId) ?? '') : '';
}

/** 손으로 고친 명단 칸의 배경 — 원본 명단과 달라진 칸 표시. */
export const EDITED_CELL_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' },
};

/** 결과코드 글자의 앞 번호 — '13. 독려' → 13. 번호가 없으면 null. */
function leadingCodeNumber(code: string): number | null {
  const m = /^\s*(\d+)/.exec(code);
  return m ? Number(m[1]) : null;
}

/**
 * 결과코드 → 숫자 맵. 앞 번호가 있는 코드는 그 번호, 없는 코드(수신거부)와 **앞 번호가 앞 코드와 겹치는
 * 코드**(「3.부재」 뒤의 「3-1.재통화」 — 결과코드는 자유 글자다)는 목록 순서대로 가장 큰 번호 다음 번호를
 * 받는다 — 한 숫자가 두 코드를 가리키지 않는다. 코딩북 값 라벨과 결과코드 열이 같은 맵을 쓴다.
 */
export function buildResultCodeNumbers(codes: readonly ContactResultCode[]): Map<string, number> {
  const sorted = [...codes].sort((a, b) => a.order - b.order);
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const c of sorted) {
    const n = leadingCodeNumber(c.code);
    if (n !== null && !used.has(n) && !out.has(c.code)) {
      out.set(c.code, n);
      used.add(n);
    }
  }
  let max = Math.max(0, ...used);
  for (const c of sorted) if (!out.has(c.code)) out.set(c.code, ++max);
  return out;
}

/**
 * 행의 결과코드 숫자 — 목록에 있으면 맵의 번호. 목록에 없는 옛 코드는 앞 번호가 목록의 어느 코드와도
 * 겹치지 않을 때만 그 번호이고, 아니면 빈칸이다(남의 번호를 빌리지 않는다 — 코딩북 「빈값」 설명 참조).
 * 맵은 행마다 다시 만들지 않도록 호출부가 한 번 만들어 넘긴다.
 */
function resultCodeCell(
  row: RawExportResponseRow,
  numbers: ReadonlyMap<string, number>,
): number | '' {
  const code = row.resultCode;
  if (!code) return '';
  const known = numbers.get(code);
  if (known !== undefined) return known;
  const n = leadingCodeNumber(code);
  if (n === null) return '';
  for (const v of numbers.values()) if (v === n) return '';
  return n;
}

const resultCodeNumbersCache = new WeakMap<RawExportContext, Map<string, number>>();
function resultCodeNumbersOf(ctx: RawExportContext): Map<string, number> {
  let m = resultCodeNumbersCache.get(ctx);
  if (!m) {
    m = buildResultCodeNumbers(ctx.resultCodes ?? []);
    resultCodeNumbersCache.set(ctx, m);
  }
  return m;
}

interface RawMetaColumn {
  header: string;
  value: (row: RawExportResponseRow, ctx: RawExportContext) => string | number;
  /** 열 생성 조건 — false 반환 시 헤더·값 모두 생략. 미지정은 항상 생성. */
  enabled?: (ctx: RawExportContext) => boolean;
  /** 이 행의 칸을 노랗게 칠할지 — 손으로 고친 명단 열. 미지정은 칠하지 않는다. */
  edited?: (row: RawExportResponseRow) => boolean;
}

/**
 * 조사 대상 명단 열이 들어갈 자리 표식 — 레이아웃 배열 안에 고정 열과 나란히 놓는다.
 * 자리를 헤더 문자열로 되찾지 않는 이유: 예전에는 findIndex(header === '개별 URL') 결과를
 * 그대로 slice 에 넘겨, 헤더를 고치거나 그 열을 빼면 -1 → slice(0, -1) 로 흘러 아무 신호 없이
 * 메타 마지막 열 바로 앞에 명단 열이 생겼다. 자리를 배열 위치로 못박으면 그 경로 자체가 없다.
 */
const CONTACT_COLUMNS_SLOT = 'contact-columns';

/** 이어 넘길 값 열 자리 표식 — 명단 열 슬롯과 같은 방식. */
const ENTRY_PARAMS_SLOT = 'entry-params';

/** 메타 열 하나 또는 열 슬롯 — 슬롯 이름은 리터럴 타입이라 오타를 tsc 가 잡는다. */
type RawMetaLayoutItem =
  | RawMetaColumn
  | typeof CONTACT_COLUMNS_SLOT
  | typeof ENTRY_PARAMS_SLOT;

/**
 * Raw Data·분할 시트 왼쪽 메타 열 레이아웃 (헤더·값·생성 조건·명단 열 자리의 단일 출처).
 * 코딩북·.sav 미포함, 헤더 1~3행 세로 병합 대상. 컨택결과코드·조사 현황은 설문 설정(컨택 존재)에
 * 따라 조건부 생성된다. 시스템ID·순번 열은 내보내지 않는다(2026-11-03 — 시스템ID 는 행 정렬에만
 * 쓴다). 조사 대상 그룹
 * 고정 열은 없다 — 그룹은 응답 내역 컬럼 설정의 attrs 열로 명단 열에 따라온다.
 */
const STATUS_HEADER = '온라인 응답 상태';
const RESULT_CODE_HEADER = '컨택결과코드';
const SURVEY_PROGRESS_HEADER = '조사 현황';
const SURVEY_DONE_LABEL = '조사완료';

/**
 * 조사 현황 — 온라인 응답을 완료했거나 컨택결과코드가 1(조사완료)이면 「조사완료」, 아니면 빈칸.
 * 실사원이 전화·대면으로 받아 1 로 처리한 대상도 조사완료로 센다(2026-11-03 피드백). 자격 미달은
 * 온라인 완료가 아니다 — 코드가 1 일 때만 조사완료.
 */
function surveyProgressCell(row: RawExportResponseRow, numbers: ReadonlyMap<string, number>): string {
  return row.status === 'completed' || resultCodeCell(row, numbers) === 1 ? SURVEY_DONE_LABEL : '';
}

const RAW_META_LAYOUT: readonly RawMetaLayoutItem[] = [
  // sha256 전체는 64자 — 동일값 식별 목적에는 앞 16자(64비트)로 충분하고 열 너비를 지킨다
  { header: 'IP 해시', value: (row) => (row.ipHash ? row.ipHash.slice(0, 16) : '') },
  CONTACT_COLUMNS_SLOT,
  ENTRY_PARAMS_SLOT,
  {
    header: '개별 URL',
    value: (row, ctx) => (row.inviteCode ? buildInviteUrl(row.inviteCode, ctx.appUrl) : ''),
  },
  { header: STATUS_HEADER, value: (row) => formatExportStatusLabel(row.status) },
  {
    header: RESULT_CODE_HEADER,
    enabled: (ctx) => ctx.hasContacts,
    value: (row, ctx) => resultCodeCell(row, resultCodeNumbersOf(ctx)),
  },
  {
    header: SURVEY_PROGRESS_HEADER,
    enabled: (ctx) => ctx.hasContacts,
    value: (row, ctx) => surveyProgressCell(row, resultCodeNumbersOf(ctx)),
  },
  { header: '마지막 입력 문항', value: (row, ctx) => resolveLastEnteredLabel(row, ctx) },
  { header: '시작일시', value: (row) => formatExcelDateTime(row.startedAt) },
  { header: '종료일시', value: (row) => formatExcelDateTime(row.completedAt) },
  {
    header: '소요시간',
    value: (row) => (isNonRespondentRow(row) ? '' : formatTotalTime(row.totalSeconds, row.status)),
  },
  {
    header: '접속 단말',
    value: (row) =>
      isNonRespondentRow(row) ? '' : formatPlatformKo(row.platform as Platform | null),
  },
];

/**
 * 활성 메타 열 = 레이아웃을 펼친 것. 고정 열은 설문 설정 조건(enabled)으로 걸러지고,
 * 슬롯 자리에는 조사 대상 명단 열이 들어간다 (명단 열이 없으면 슬롯은 0열로 사라진다).
 * 명단 열을 RawMetaColumn 으로 흘리면 3행 세로 병합·너비·같은 질문 가로 병합 오프셋이
 * Raw Data·분할 시트에서 같은 코드로 따라온다. 응답 내역 시트는 자기 헤더를 따로 가진다.
 */
function activeMetaColumns(ctx: RawExportContext): RawMetaColumn[] {
  return RAW_META_LAYOUT.flatMap<RawMetaColumn>((item) => {
    if (item === CONTACT_COLUMNS_SLOT) {
      return (ctx.contactColumns ?? []).map<RawMetaColumn>((col) => ({
        header: col.label,
        value: (row) => row.contactValues?.[col.source] ?? '',
        edited: (row) => row.editedSources?.has(col.source) ?? false,
      }));
    }
    if (item === ENTRY_PARAMS_SLOT) {
      return (ctx.entryParamNames ?? []).map<RawMetaColumn>((name) => ({
        header: name,
        value: (row) => row.entryParams?.[name] ?? '',
      }));
    }
    return (item.enabled?.(ctx) ?? true) ? [item] : [];
  });
}

export function buildRawMetaHeaders(ctx: RawExportContext): string[] {
  return activeMetaColumns(ctx).map((c) => c.header);
}

/**
 * 메타 열 중 손으로 고친 명단 칸을 노랗게 칠한다 — Raw Data·분할 변수 시트 공용.
 * firstDataRow 는 첫 데이터 행 번호(헤더 3행이면 4). 행 순서는 rows 와 같다.
 */
export function paintEditedMetaCells(
  ws: ExcelJS.Worksheet,
  rows: readonly RawExportResponseRow[],
  ctx: RawExportContext,
  firstDataRow: number,
): void {
  const cols = activeMetaColumns(ctx);
  rows.forEach((row, i) => {
    if (!row.editedSources?.size) return;
    cols.forEach((col, c) => {
      if (col.edited?.(row)) ws.getRow(firstDataRow + i).getCell(c + 1).fill = EDITED_CELL_FILL;
    });
  });
}

export function buildRawMetaValues(
  row: RawExportResponseRow,
  ctx: RawExportContext,
): (string | number)[] {
  return activeMetaColumns(ctx).map((c) => c.value(row, ctx));
}

/**
 * '응답 내역' 시트 — 응답자 메타 요약 (Raw/분할 워크북 공용).
 * 컨택결과코드·조사 현황 열은 메타 열과 동일한 조건부 생성 규칙을 따르고(온라인 응답 상태 다음),
 * 조사 대상 명단 열은 맨 앞(접속 단말 앞)에 붙는다. 손으로 고친 명단 칸은 노랗다.
 */
export function addResponseListSheet(
  workbook: ExcelJS.Workbook,
  rows: RawExportResponseRow[],
  ctx: RawExportContext,
): void {
  const ws = workbook.addWorksheet('응답 내역');
  const contactColumns = ctx.contactColumns ?? [];
  const entryParamNames = ctx.entryParamNames ?? [];
  const headers = [
    ...contactColumns.map((c) => c.label),
    ...entryParamNames,
    '접속 단말',
    '브라우저',
    STATUS_HEADER,
    ...(ctx.hasContacts ? [RESULT_CODE_HEADER, SURVEY_PROGRESS_HEADER] : []),
    '시작일시',
    '종료일시',
    '소요시간',
  ];
  ws.addRow(headers);
  const codeNumbers = resultCodeNumbersOf(ctx);
  // 명단 열은 1열부터
  const contactColumnStart = 1;
  rows.forEach((row) => {
    // 미응답 조사 대상 행은 응답 메타(단말·브라우저·소요시간)를 빈칸으로 둔다 —
    // RAW_META_LAYOUT 와 같은 분기. 응답 행의 출력은 바뀌지 않는다.
    const nonRespondent = isNonRespondentRow(row);
    const added = ws.addRow([
      ...contactColumns.map((c) => row.contactValues?.[c.source] ?? ''),
      ...entryParamNames.map((name) => row.entryParams?.[name] ?? ''),
      nonRespondent ? '' : formatPlatformKo(row.platform as Platform | null),
      nonRespondent ? '' : (row.browser ?? 'Other'),
      formatExportStatusLabel(row.status),
      ...(ctx.hasContacts
        ? [resultCodeCell(row, codeNumbers), surveyProgressCell(row, codeNumbers)]
        : []),
      formatExcelDateTime(row.startedAt),
      formatExcelDateTime(row.completedAt),
      nonRespondent ? '' : formatTotalTime(row.totalSeconds, row.status),
    ]);
    if (row.editedSources?.size) {
      contactColumns.forEach((c, i) => {
        if (row.editedSources?.has(c.source)) {
          added.getCell(contactColumnStart + i).fill = EDITED_CELL_FILL;
        }
      });
    }
  });
  styleHeaderRows(ws, [1], headers.length);
  autoFitRawColumns(ws, headers.length);
}

/**
 * 시트 분리 없는 3시트 Raw Data 워크북.
 * - 응답 내역: 응답자 메타 (응답 내역 페이지 재현)
 * - Raw Data: 응답 × 변수 wide table (SPSS 코드값), 헤더 3행
 * - 코딩북: 변수 정의 + 값 라벨
 * rows 는 started_at ASC 정렬된 동일 모수.
 */
export function generateRawDataWorkbook(
  questions: Question[],
  rows: RawExportResponseRow[],
  ctx: RawExportContext,
): ExcelJS.Workbook {
  // 질문은 order 순으로 정렬해 컬럼/코딩북 순서를 설문 표시 순서와 일치시킨다.
  const sortedQuestions = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const exportCtx = withUsedRepeatCounts(ctx, sortedQuestions, rows);
  const columns = generateSPSSColumns(sortedQuestions, toSpssColumnOptions(exportCtx));
  const questionMap = new Map(sortedQuestions.map((q) => [q.id, q]));

  const workbook = new ExcelJS.Workbook();

  // 시트 1: 응답 내역
  addResponseListSheet(workbook, rows, ctx);

  // 시트 2: Raw Data (헤더 3행 = 질문제목 / 셀라벨 / SPSS 변수명), 왼쪽 메타 열 + 변수 열
  const ws2 = workbook.addWorksheet('Raw Data');
  const metaHeaders = buildRawMetaHeaders(ctx);
  const metaCount = metaHeaders.length;
  const colCount = columns.length + metaCount;
  ws2.addRow([...metaHeaders, ...columns.map((c) => c.questionText)]);
  ws2.addRow([...metaHeaders.map(() => ''), ...columns.map((c) => columnCellLabel(c))]);
  ws2.addRow([...metaHeaders.map(() => ''), ...columns.map((c) => c.spssVarName)]);
  rows.forEach((row) => {
    ws2.addRow([
      ...buildRawMetaValues(row, ctx),
      ...buildDataRow(columns, questionMap, row as unknown as SurveySubmission),
    ]);
  });
  paintEditedMetaCells(ws2, rows, ctx, 4);

  // 1~3행 헤더 스타일
  styleHeaderRows(ws2, [1, 2, 3], colCount);
  // 메타 열은 1~3행 세로 병합 (SPSS 변수가 아니므로 변수명 행 없음)
  for (let c = 1; c <= metaCount; c++) ws2.mergeCells(1, c, 3, c);
  // 1행: 같은 질문(questionId)에 속한 연속 변수 열을 가로 병합 — 메타 열만큼 오프셋
  let start = 0;
  while (start < columns.length) {
    let end = start;
    while (
      end + 1 < columns.length &&
      columns[end + 1]?.questionId === columns[start]?.questionId
    ) {
      end++;
    }
    if (end > start) ws2.mergeCells(1, start + metaCount + 1, 1, end + metaCount + 1);
    start = end + 1;
  }
  // 열 너비: 메타 열은 표본 기반, 변수 열은 2행(셀라벨) 기준
  autoFitRawColumnRange(ws2, 1, metaCount);
  columns.forEach((c, i) => {
    ws2.getColumn(i + metaCount + 1).width = clampRawWidth(estimateTextWidth(columnCellLabel(c)));
  });

  // 시트 3: 코딩북
  appendCodebookSheet(workbook, columns, sortedQuestions, ctx);

  return workbook;
}

/** 상태 열에 나오는 글자 — formatExportStatusLabel 의 어휘 그대로. */
const EXPORT_STATUS_VALUE_LABEL = [
  'completed',
  'screened_out',
  'quotaful_out',
  'bad',
  'in_progress',
  'drop',
  NOT_RESPONDED_STATUS,
]
  .map((status) => formatExportStatusLabel(status))
  .join(', ');

/** 코딩북 시트를 워크북에 추가한다 — Raw/Split 워크북 공용. */
export function appendCodebookSheet(
  workbook: ExcelJS.Workbook,
  columns: SPSSExportColumn[],
  questions: Question[],
  ctx?: Pick<RawExportContext, 'hasContacts' | 'resultCodes'>,
): void {
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const mrsetNames = buildMrsetNameMap(columns, questions);
  const ws = workbook.addWorksheet('코딩북');
  ws.addRow([
    '변수번호',
    'SPSS 변수명',
    '질문 제목',
    '셀라벨',
    '값 라벨',
    '변수 유형',
    '측정 수준',
    '표시 형식',
    '다중응답 세트',
    // .sav 에 실제로 들어가는 변수 라벨 — SPSS 화면과 같은 글자를 코딩북에서도 본다.
    // 맨 끝에 두는 것은 앞 열을 위치로 읽는 기존 작업을 깨지 않기 위해서다.
    'SPSS 변수 라벨',
  ]);
  columns.forEach((c, i) => {
    const question = questionMap.get(c.questionId);
    const metadata = buildCodebookVariableMetadata(c, question);
    ws.addRow([
      i + 1,
      c.spssVarName,
      c.questionText,
      // 셀라벨은 Raw Data 2행과 같은 값(columnCellLabel)
      columnCellLabel(c),
      buildCodebookValueLabel(c, questionMap),
      metadata.variableType,
      metadata.measure,
      metadata.displayFormat,
      mrsetNames.get(c.spssVarName) ?? '',
      buildLabel(c, question?.questionCode),
    ]);
  });
  // 메타 열의 값 라벨 — SPSS 변수가 아니라 번호·변수 유형 칸은 비운다. 변수 행 뒤에 붙여
  // 앞 행을 위치로 읽는 기존 작업을 깨지 않는다.
  if (ctx) {
    ws.addRow(['', STATUS_HEADER, '온라인 응답 상태', '', EXPORT_STATUS_VALUE_LABEL]);
    if (ctx.hasContacts) {
      const numbers = buildResultCodeNumbers(ctx.resultCodes ?? []);
      const label = [...numbers]
        .sort((a, b) => a[1] - b[1])
        .map(([code, n]) => `${n}=${code.replace(/^\s*\d+\s*\.\s*/, '')}`)
        .join(', ');
      ws.addRow([
        '',
        RESULT_CODE_HEADER,
        '조사 대상의 마지막 회차 결과코드',
        '',
        ['빈값=회차 없음 또는 목록에 없는 코드', ...(label ? [label] : [])].join(', '),
      ]);
      ws.addRow([
        '',
        SURVEY_PROGRESS_HEADER,
        '온라인 응답 완료 또는 컨택결과코드 1',
        '',
        `${SURVEY_DONE_LABEL}=온라인 응답 완료 또는 컨택결과코드 1, 빈값=그 외`,
      ]);
    }
  }
  styleHeaderRows(ws, [1], 10);
  autoFitRawColumns(ws, 10);
}

// ── Raw/Split 워크북 공통 스타일·레이아웃 헬퍼 ──

const RAW_MIN_WIDTH = 8;
const RAW_MAX_WIDTH = 60;
const RAW_WIDTH_PADDING = 2;

/** 텍스트 표시 너비 추정 (CJK 문자 1.8배). */
export function estimateTextWidth(value: unknown): number {
  if (value === null || value === undefined) return 0;
  let width = 0;
  for (const ch of String(value)) {
    const code = ch.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef);
    width += isCjk ? 1.8 : 1;
  }
  return width;
}

export function clampRawWidth(width: number): number {
  return Math.min(RAW_MAX_WIDTH, Math.max(RAW_MIN_WIDTH, width + RAW_WIDTH_PADDING));
}

/** 지정한 행들을 헤더 스타일(파란 배경 + 흰 굵은 글씨 + 테두리 + 가운데 정렬)로 칠한다. */
export function styleHeaderRows(ws: ExcelJS.Worksheet, rowNums: number[], colCount: number): void {
  for (const rowNum of rowNums) {
    const row = ws.getRow(rowNum);
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = HEADER_BORDER;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    row.height = 22;
  }
}

/** 헤더 + 데이터 일부를 표본으로 지정 범위 열 너비를 자동 맞춤. */
export function autoFitRawColumnRange(
  ws: ExcelJS.Worksheet,
  startCol: number,
  endCol: number,
): void {
  const sampleEnd = Math.min(ws.rowCount, 200);
  for (let c = startCol; c <= endCol; c++) {
    let max = 0;
    for (let r = 1; r <= sampleEnd; r++) {
      max = Math.max(max, estimateTextWidth(ws.getRow(r).getCell(c).value));
    }
    ws.getColumn(c).width = clampRawWidth(max);
  }
}

/** 헤더 + 데이터 일부를 표본으로 열 너비를 자동 맞춤 (시트1/코딩북용). */
export function autoFitRawColumns(ws: ExcelJS.Worksheet, colCount: number): void {
  autoFitRawColumnRange(ws, 1, colCount);
}
