import ExcelJS from 'exceljs';

import { HEADER_BORDER, HEADER_FILL, HEADER_FONT } from '@/lib/analytics/export-styles';
import { buildCodebookValueLabel, formatExcelDateTime } from '@/lib/analytics/raw-export-helpers';
import {
  type SPSSExportColumn,
  type SpssColumnOptions,
  buildDataRow,
  generateSPSSColumns,
} from '@/lib/analytics/spss-excel-export';
import { RESID_DEFAULT_LABEL, type RawExportContactColumn } from '@/lib/operations/contacts';
import { type Platform, formatPlatformKo } from '@/lib/operations/parse-ua';
import {
  NOT_RESPONDED_STATUS,
  formatExportStatusLabel,
  formatTotalTime,
} from '@/lib/operations/profiles';
import { buildCodebookVariableMetadata } from '@/lib/spss/export-metadata';
import { buildMrsetNameMap } from '@/lib/spss/mrsets-syntax';
import { buildInviteUrl } from '@/lib/survey-url';
import { Question, SurveySubmission } from '@/types/survey';

// ============================================================
// Raw Data 워크북
// ============================================================

export interface RawExportResponseRow {
  /** 응답 id. 미응답 행은 contact_targets.id (파일 안에서 유일 — 미응답 대상은 응답 행이 없다) */
  id: string;
  /** 미응답 행은 {} */
  questionResponses: Record<string, unknown>;
  groupValue: string | null;
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
  /**
   * 조사 대상 명단 열 값 — source → 값 (RawExportContext.contactColumns 의 source 와 같은 키).
   * 조사 대상이 없는 익명 응답은 키 자체가 없고, 컨택은 있으나 값이 없는 키는 ''.
   */
  contactValues?: Readonly<Record<string, string>>;
}

/** 미응답 조사 대상 행 — 응답이 아니므로 응답 메타(단말·소요시간 등)를 빈칸으로 그린다. */
export function isNonRespondentRow(row: Pick<RawExportResponseRow, 'status'>): boolean {
  return row.status === NOT_RESPONDED_STATUS;
}

/**
 * 순번 = 접수 순번. 모수 안의 응답 행을 시작일시 오름차순으로 1부터 매긴다 (같은 시각은 입력 순).
 * 파일의 행 정렬(조사 대상 기준 모수는 시스템ID 순)과 무관하고, 미응답 행은 순번이 없다.
 * 워크북의 모든 시트가 같은 맵을 써서 시트 간 순번이 정합하다. 키는 행 객체다(id 가 아니라) —
 * 시트마다 같은 rows 배열을 돌리므로 충분하고, 픽스처의 id 중복에 흔들리지 않는다.
 */
export function buildRawSeqMap(
  rows: readonly RawExportResponseRow[],
): ReadonlyMap<RawExportResponseRow, number> {
  const responded = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !isNonRespondentRow(row));
  responded.sort(
    (a, b) =>
      (a.row.startedAt?.getTime() ?? 0) - (b.row.startedAt?.getTime() ?? 0) || a.index - b.index,
  );
  const map = new Map<RawExportResponseRow, number>();
  responded.forEach(({ row }, i) => map.set(row, i + 1));
  return map;
}

export interface RawExportContext {
  /** NEXT_PUBLIC_APP_URL 정리값 (trailing slash 제거). 미설정 시 '' — 상대경로 /i/{code} 출력 */
  appUrl: string;
  /** currentStepId → 표시 라벨 (buildStepLabelMap 결과) */
  stepLabels: ReadonlyMap<string, string>;
  /** 설문에 컨택 타겟이 존재하는지 — false 면 시스템ID 열을 만들지 않는다 (응답 매칭 여부 무관, 설문 설정 기준) */
  hasContacts: boolean;
  /** 컨택 타겟에 그룹값이 하나라도 설정돼 있는지 — false 면 조사 대상 그룹 열을 만들지 않는다 */
  hasContactGroups: boolean;
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
   * 조사 대상 명단 열 — 응답 내역 컬럼 설정에서 표시 중인 attrs·pii 열. 순번(그룹 열이 있으면 그룹)과
   * 개별 URL 사이에 들어간다. 비어 있거나 없으면 명단 열이 없는 열 구성이다.
   */
  contactColumns?: readonly RawExportContactColumn[];
}

/**
 * 워크북 컨텍스트에서 컬럼 생성 옵션을 뽑는다.
 * 호출부마다 조건부 spread 를 반복하면 옵션이 하나 늘 때마다 드리프트가 생긴다.
 */
export function toSpssColumnOptions(ctx: RawExportContext): SpssColumnOptions {
  return ctx.changeConfirmQuestionIds
    ? { changeConfirmQuestionIds: ctx.changeConfirmQuestionIds }
    : {};
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

interface RawMetaColumn {
  header: string;
  /** seq 는 접수 순번(buildRawSeqMap) — 미응답 행은 null 이라 빈칸이다 */
  value: (row: RawExportResponseRow, seq: number | null, ctx: RawExportContext) => string | number;
  /** 열 생성 조건 — false 반환 시 헤더·값 모두 생략. 미지정은 항상 생성. */
  enabled?: (ctx: RawExportContext) => boolean;
}

/**
 * Raw Data·분할 시트 왼쪽 메타 열 정의 (헤더·값·생성 조건의 단일 출처).
 * 코딩북·.sav 미포함, 헤더 1~3행 세로 병합 대상. 시스템ID·조사 대상 그룹은
 * 설문 설정(컨택 존재/그룹 사용)에 따라 조건부 생성된다.
 */
const RAW_META_COLUMNS: RawMetaColumn[] = [
  // sha256 전체는 64자 — 동일값 식별 목적에는 앞 16자(64비트)로 충분하고 열 너비를 지킨다
  { header: 'IP 해시', value: (row) => (row.ipHash ? row.ipHash.slice(0, 16) : '') },
  {
    header: RESID_DEFAULT_LABEL,
    enabled: (ctx) => ctx.hasContacts,
    value: (row) => row.resid ?? '',
  },
  { header: '순번', value: (_row, seq) => seq ?? '' },
  {
    header: '조사 대상 그룹',
    enabled: (ctx) => ctx.hasContactGroups,
    // '공개링크' 는 익명 응답의 표식 — 응답이 아닌 조사 대상 행에는 붙이지 않는다.
    value: (row) => row.groupValue ?? (isNonRespondentRow(row) ? '' : '공개링크'),
  },
  {
    header: '개별 URL',
    value: (row, _seq, ctx) => (row.inviteCode ? buildInviteUrl(row.inviteCode, ctx.appUrl) : ''),
  },
  { header: '상태', value: (row) => formatExportStatusLabel(row.status) },
  { header: '마지막 입력 문항', value: (row, _seq, ctx) => resolveLastEnteredLabel(row, ctx) },
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

const INVITE_URL_HEADER = '개별 URL';

/**
 * 활성 메타 열 = 고정 메타 열(설문 설정 조건부)에 조사 대상 명단 열을 개별 URL 바로 앞에 끼운 것.
 * 명단 열을 RawMetaColumn 으로 흘리면 3행 세로 병합·너비·같은 질문 가로 병합 오프셋이
 * Raw Data·분할 시트에서 같은 코드로 따라온다. 응답 내역 시트는 자기 헤더를 따로 가진다.
 */
function activeMetaColumns(ctx: RawExportContext): RawMetaColumn[] {
  const fixed = RAW_META_COLUMNS.filter((c) => c.enabled?.(ctx) ?? true);
  const contact = (ctx.contactColumns ?? []).map<RawMetaColumn>((col) => ({
    header: col.label,
    value: (row) => row.contactValues?.[col.source] ?? '',
  }));
  const at = fixed.findIndex((c) => c.header === INVITE_URL_HEADER);
  return [...fixed.slice(0, at), ...contact, ...fixed.slice(at)];
}

export function buildRawMetaHeaders(ctx: RawExportContext): string[] {
  return activeMetaColumns(ctx).map((c) => c.header);
}

export function buildRawMetaValues(
  row: RawExportResponseRow,
  seq: number | null,
  ctx: RawExportContext,
): (string | number)[] {
  return activeMetaColumns(ctx).map((c) => c.value(row, seq, ctx));
}

/**
 * '응답 내역' 시트 — 응답자 메타 요약 (Raw/분할 워크북 공용).
 * 시스템ID·조사 대상 그룹 열은 메타 열과 동일한 조건부 생성 규칙을 따르고, 조사 대상 명단 열은
 * 그룹 다음·접속 단말 앞에 같은 열이 붙는다. 순번은 seqMap(접수 순번)을 Raw Data 시트와 공유한다.
 */
export function addResponseListSheet(
  workbook: ExcelJS.Workbook,
  rows: RawExportResponseRow[],
  ctx: RawExportContext,
  seqMap: ReadonlyMap<RawExportResponseRow, number> = buildRawSeqMap(rows),
): void {
  const ws = workbook.addWorksheet('응답 내역');
  const contactColumns = ctx.contactColumns ?? [];
  const headers = [
    ...(ctx.hasContacts ? [RESID_DEFAULT_LABEL] : []),
    '순번',
    ...(ctx.hasContactGroups ? ['조사 대상 그룹'] : []),
    ...contactColumns.map((c) => c.label),
    '접속 단말',
    '브라우저',
    '상태',
    '시작일시',
    '종료일시',
    '소요시간',
  ];
  ws.addRow(headers);
  rows.forEach((row) => {
    // 미응답 조사 대상 행은 응답 메타(단말·브라우저·소요시간)와 익명 표식을 빈칸으로 둔다 —
    // RAW_META_COLUMNS 와 같은 분기. 응답 행의 출력은 바뀌지 않는다.
    const nonRespondent = isNonRespondentRow(row);
    ws.addRow([
      ...(ctx.hasContacts ? [row.resid ?? ''] : []),
      seqMap.get(row) ?? '',
      ...(ctx.hasContactGroups ? [row.groupValue ?? (nonRespondent ? '' : '공개링크')] : []),
      ...contactColumns.map((c) => row.contactValues?.[c.source] ?? ''),
      nonRespondent ? '' : formatPlatformKo(row.platform as Platform | null),
      nonRespondent ? '' : (row.browser ?? 'Other'),
      formatExportStatusLabel(row.status),
      formatExcelDateTime(row.startedAt),
      formatExcelDateTime(row.completedAt),
      nonRespondent ? '' : formatTotalTime(row.totalSeconds, row.status),
    ]);
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
  const columns = generateSPSSColumns(sortedQuestions, toSpssColumnOptions(ctx));
  const questionMap = new Map(sortedQuestions.map((q) => [q.id, q]));

  const workbook = new ExcelJS.Workbook();
  const seqMap = buildRawSeqMap(rows);

  // 시트 1: 응답 내역
  addResponseListSheet(workbook, rows, ctx, seqMap);

  // 시트 2: Raw Data (헤더 3행 = 질문제목 / 셀라벨 / SPSS 변수명), 왼쪽 메타 열 + 변수 열
  const ws2 = workbook.addWorksheet('Raw Data');
  const metaHeaders = buildRawMetaHeaders(ctx);
  const metaCount = metaHeaders.length;
  const colCount = columns.length + metaCount;
  ws2.addRow([...metaHeaders, ...columns.map((c) => c.questionText)]);
  ws2.addRow([...metaHeaders.map(() => ''), ...columns.map((c) => row2Label(c))]);
  ws2.addRow([...metaHeaders.map(() => ''), ...columns.map((c) => c.spssVarName)]);
  rows.forEach((row) => {
    ws2.addRow([
      ...buildRawMetaValues(row, seqMap.get(row) ?? null, ctx),
      ...buildDataRow(columns, questionMap, row as unknown as SurveySubmission),
    ]);
  });

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
    ws2.getColumn(i + metaCount + 1).width = clampRawWidth(estimateTextWidth(row2Label(c)));
  });

  // 시트 3: 코딩북
  appendCodebookSheet(workbook, columns, sortedQuestions);

  return workbook;
}

/** 코딩북 시트를 워크북에 추가한다 — Raw/Split 워크북 공용. */
export function appendCodebookSheet(
  workbook: ExcelJS.Workbook,
  columns: SPSSExportColumn[],
  questions: Question[],
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
  ]);
  columns.forEach((c, i) => {
    const metadata = buildCodebookVariableMetadata(c, questionMap.get(c.questionId));
    ws.addRow([
      i + 1,
      c.spssVarName,
      c.questionText,
      c.cellExportLabel ?? '',
      buildCodebookValueLabel(c, questionMap),
      metadata.variableType,
      metadata.measure,
      metadata.displayFormat,
      mrsetNames.get(c.spssVarName) ?? '',
    ]);
  });
  styleHeaderRows(ws, [1], 9);
  autoFitRawColumns(ws, 9);
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

/** Raw Data 헤더 행2: 테이블 셀라벨 > 옵션 분리 열 라벨 > 공백 */
export function row2Label(c: SPSSExportColumn): string {
  if (c.cellExportLabel) return c.cellExportLabel;
  if (
    c.type === 'checkbox-item' ||
    c.type === 'choice-group' ||
    c.type === 'choice-group-item' ||
    c.type === 'ranking-rank' ||
    c.type === 'ranking-other' ||
    c.type === 'ranking-option-text' ||
    c.type === 'option-text' ||
    c.type === 'other-text' ||
    c.type === 'table-cell-option-text' ||
    c.type === 'table-cell-ranking-other' ||
    c.type === 'table-cell-ranking-option-text'
  ) {
    return c.optionLabel ?? '';
  }
  return '';
}
