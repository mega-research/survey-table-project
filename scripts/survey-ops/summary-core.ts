/**
 * 설문 구조 요약 — `pnpm survey:summary` 의 코어. DB·파일을 모르는 순수 함수다.
 *
 * - `summarizeStructure` 문항당 한 줄: 쪽 · 문항코드 · 유형과 크기 · 필수 · 칸 유형 수 · 보기 그룹 ·
 *   모바일 표시 방식 · 표시 조건 · 열림 조건 수 · 검증 수 · 변수 수 · 제목
 * - `describeQuestion` 문항 하나를 편다: 열 · 보기 그룹 · 줄마다 칸 · 검증
 *
 * 줄 모양이 곧 계약이다(`tests/repo/survey-ops-summary.test.ts`). 모바일 표시 방식은 한글 이름이 아니라
 * 패치가 쓰는 코드값을 찍는다. 꺼 둔 조건은 평가기처럼 건너뛴다.
 */
import type { CellEnableCondition } from '@/types/survey';
import { collectGateControllerIds } from '@/utils/cell-gate-tree';

import {
  buildStructureColumns,
  clip,
  stripHtml,
  type RawCell,
  type RawConditionGroup,
  type RawOption,
  type RawQuestion,
  type RawSumConstraint,
} from './check-core';

/** 점검이 보지 않는 표시용 필드까지 — 저장본을 그대로 읽는다 */
type SummaryQuestion = RawQuestion & {
  groupId?: string | null;
  pageBreakBefore?: boolean | null;
  inputType?: string | null;
  piiEncrypted?: boolean | null;
  selectLevels?: unknown[] | null;
  rankingConfig?: { positions?: number; requireAllPositions?: boolean } | null;
};
type SummaryCell = RawCell & {
  mobileDisplay?: string;
  piiEncrypted?: boolean;
};
type SummaryOption = RawOption & { allowTextInput?: boolean };
type SummaryColumn = { id: string; label?: string; columnCode?: string } & {
  displayCondition?: RawConditionGroup | null;
};
type SummaryConstraint = RawSumConstraint & {
  target?: number;
  operator?: string;
  aggregate?: string;
  errorMessage?: string;
  targetExpr?: { kind?: string; cellId?: string; questionId?: string } | null;
};

export interface SummaryInput {
  questions: readonly RawQuestion[];
  groups?: readonly unknown[];
}

const OPERATORS: Record<string, string> = { gte: '≥', lte: '≤', eq: '=', gt: '>', lt: '<', ne: '≠' };
const oneLine = (s: string | null | undefined) => stripHtml(s ?? '').replace(/\n/g, ' ');

function sorted(input: SummaryInput): SummaryQuestion[] {
  return [...input.questions].sort((a, b) => a.order - b.order) as SummaryQuestion[];
}

function codeOf(q: RawQuestion): string {
  return q.questionCode || '-';
}

/** 칸 id → `r01c02`. 그 표에 없으면 null */
function cellPosition(q: RawQuestion, cellId: string | undefined): string | null {
  if (!cellId) return null;
  const columns = q.tableColumns ?? [];
  for (const [ri, r] of (q.tableRowsData ?? []).entries()) {
    const ci = r.cells.findIndex((c) => c.id === cellId);
    if (ci >= 0) return `${r.rowCode ?? `r${ri + 1}`}${columns[ci]?.columnCode ?? `c${ci + 1}`}`;
  }
  return null;
}

/** 표시 조건 한 묶음을 `A2=1|3 AND C1=식` 꼴로. 켜진 조건이 없으면 빈 글자 */
function describeConditions(
  group: RawConditionGroup | null | undefined,
  byId: Map<string, SummaryQuestion>,
): string {
  const logic = (group as { logicType?: string } | null | undefined)?.logicType === 'OR' ? 'OR' : 'AND';
  const parts: string[] = [];
  for (const cond of group?.conditions ?? []) {
    if (cond.enabled === false) continue;
    const type = cond.conditionType ?? 'value-match';
    if (type === 'expression') {
      parts.push('식');
      continue;
    }
    const src = cond.sourceQuestionId ? byId.get(cond.sourceQuestionId) : undefined;
    const name = src ? codeOf(src) : '?';
    if (type !== 'value-match') {
      parts.push(`${name}(${type})`);
      continue;
    }
    // 보기 칸을 보는 조건은 값이 칸 id 다 — 사람이 읽을 수 있게 그 칸의 응답값으로 적는다
    const choiceCodes = new Map(
      (src?.tableRowsData ?? [])
        .flatMap((r) => r.cells)
        .filter((c) => c.type === 'choice_opt')
        .map((c) => [c.id, c.spssNumericCode]),
    );
    const values = (cond.requiredValues ?? []).map((v) =>
      choiceCodes.has(v) ? `#${choiceCodes.get(v) ?? '?'}` : clip(v, 10),
    );
    parts.push(`${name}=${values.join('|')}`);
  }
  return parts.join(` ${logic} `);
}

function typeAndShape(q: SummaryQuestion): string {
  const rows = q.tableRowsData ?? [];
  const columns = q.tableColumns ?? [];
  const options = (q.options ?? []) as SummaryOption[];
  const optionPart = `보기${options.length}${options.some((o) => o.allowTextInput) ? '(기타)' : ''}`;
  switch (q.type) {
    case 'table':
      return `table ${rows.length}×${columns.length}`;
    case 'ranking':
      return `ranking ${optionPart} ${q.rankingConfig?.positions ?? '?'}순위`;
    case 'multiselect':
      return `multiselect ${q.selectLevels?.length ?? '?'}단계`;
    case 'text':
    case 'textarea':
      return q.inputType && q.inputType !== 'text' ? `${q.type}(${q.inputType})` : q.type;
    case 'notice':
      return 'notice';
    default:
      // 보기 표를 내장한 단일·복수 선택은 보기가 표의 칸이다
      return rows.length > 0 ? `${q.type} 보기표 ${rows.length}×${columns.length}` : `${q.type} ${optionPart}`;
  }
}

function summaryParts(q: SummaryQuestion, byId: Map<string, SummaryQuestion>): string[] {
  const parts = [typeAndShape(q)];
  if (q.required) parts.push('필수');

  const rows = q.tableRowsData ?? [];
  const columns = (q.tableColumns ?? []) as SummaryColumn[];
  const cells = rows.flatMap((r) => r.cells).filter((c) => !c.isHidden) as SummaryCell[];

  const counts = new Map<string, number>();
  for (const c of cells) if (c.type !== 'text') counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  if (counts.size > 0) parts.push([...counts].map(([type, n]) => `${type}${n}`).join(' '));

  const groupKeys = (q.choiceGroups ?? []).map((g) => g.groupKey ?? g.id);
  if (groupKeys.length > 0)
    parts.push(
      `그룹 ${groupKeys.length > 4 ? `${groupKeys.slice(0, 3).join(' ')} …(${groupKeys.length})` : groupKeys.join(' ')}`,
    );

  if (rows.length > 0 && q.mobileTableDisplayMode && q.mobileTableDisplayMode !== 'auto')
    parts.push(`모바일 ${q.mobileTableDisplayMode}`);

  const condition = describeConditions(q.displayCondition, byId);
  if (condition) parts.push(`조건 ${condition}`);

  const scoped = (
    items: Array<{ code: string; group: RawConditionGroup | null | undefined }>,
    label: string,
  ) => {
    const hit = items
      .map((item) => ({ code: item.code, sources: conditionSources(item.group, byId) }))
      .filter((item) => item.sources.length > 0);
    if (hit.length === 0) return;
    const sources = [...new Set(hit.flatMap((h) => h.sources))];
    parts.push(`${label} ${hit.map((h) => h.code).join('·')}(${sources.join(',')})`);
  };
  scoped(
    columns.map((c, i) => ({ code: c.columnCode ?? `c${i + 1}`, group: c.displayCondition })),
    '열조건',
  );
  scoped(
    rows.map((r, i) => ({ code: r.rowCode ?? `r${i + 1}`, group: r.displayCondition })),
    '행조건',
  );

  const gated = cells.filter((c) => c.enabledWhen != null).length;
  if (gated > 0) parts.push(`열림 ${gated}칸`);
  const gatedOptions = cells
    .flatMap((c) => [
      ...(c.selectOptions ?? []),
      ...(c.radioOptions ?? []),
      ...(c.checkboxOptions ?? []),
    ])
    .filter((o) => o.enabledWhen != null).length;
  if (gatedOptions > 0) parts.push(`보기조건 ${gatedOptions}`);

  const constraints = (q.sumConstraints ?? []).length;
  if (constraints > 0) parts.push(`제약 ${constraints}`);
  const calcChecks = cells.filter((c) => c.calcValidation != null).length;
  if (calcChecks > 0) parts.push(`합계검증 ${calcChecks}`);
  if (q.rowRepeatConfig) parts.push('반복');
  const encrypted = cells.filter((c) => c.piiEncrypted).length + (q.piiEncrypted ? 1 : 0);
  if (encrypted > 0) parts.push(`암호화 ${encrypted}`);
  return parts;
}

/** 켜진 조건이 보는 문항코드들 (수식 조건은 「식」) */
function conditionSources(
  group: RawConditionGroup | null | undefined,
  byId: Map<string, SummaryQuestion>,
): string[] {
  const sources: string[] = [];
  for (const cond of group?.conditions ?? []) {
    if (cond.enabled === false) continue;
    if ((cond.conditionType ?? 'value-match') === 'expression') sources.push('식');
    else {
      const src = cond.sourceQuestionId ? byId.get(cond.sourceQuestionId) : undefined;
      sources.push(src ? codeOf(src) : '?');
    }
  }
  return [...new Set(sources)];
}

export function summarizeStructure(
  input: SummaryInput,
  title: string,
  options: { grep?: RegExp } = {},
): string[] {
  const questions = sorted(input);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const groupNames = new Map(
    (input.groups ?? []).map((g) => {
      const group = g as { id: string; name?: string };
      return [group.id, group.name ?? group.id];
    }),
  );
  const { columns, countByQuestion } = buildStructureColumns(questions, input.groups ?? []);

  let page = 1;
  const pages = new Map<string, number>();
  questions.forEach((q, i) => {
    if (i > 0 && q.pageBreakBefore) page += 1;
    pages.set(q.id, page);
  });

  const lines = [
    `${title} — 문항 ${questions.length} · 그룹 ${groupNames.size} · 쪽 ${page} · 변수 ${columns.length}`,
  ];
  let currentGroup: string | null | undefined;
  for (const q of questions) {
    if (options.grep && !options.grep.test(q.questionCode ?? '')) continue;
    if (q.groupId !== currentGroup) {
      currentGroup = q.groupId;
      if (q.groupId && groupNames.has(q.groupId)) lines.push(`# ${groupNames.get(q.groupId)}`);
    }
    const parts = summaryParts(q, byId);
    const variables = countByQuestion.get(q.id) ?? 0;
    if (variables > 0) parts.push(`변수 ${variables}`);
    lines.push(
      `p${pages.get(q.id)} ${codeOf(q).padEnd(6)} ${parts.join(' · ')} — ${clip(oneLine(q.title), 40)}`,
    );
  }
  return lines;
}

// ── 문항 하나 ─────────────────────────────────────────────────────────────────────────────

function spanSuffix(c: RawCell): string {
  const spans = [
    (c.colspan ?? 1) > 1 ? `×c${c.colspan}` : '',
    (c.rowspan ?? 1) > 1 ? `×r${c.rowspan}` : '',
  ].join('');
  return spans ? ` ${spans}` : '';
}

/** 줄을 접을 때의 모양 비교용 — 칸 이름(모바일 라벨)만 다른 줄은 같은 모양으로 본다 */
function withoutMobileLabel(c: SummaryCell): SummaryCell {
  const { mobileLabel: _dropped, ...rest } = c;
  void _dropped;
  return rest;
}

/** 칸 하나의 글자 — `choiceCode` 는 줄을 접을 때 범위(1…3)로 바꿔 끼운다 */
function describeCell(q: SummaryQuestion, c: SummaryCell, choiceCode?: string): string {
  if (c.isHidden) return '·';
  const optionCount = (options: RawOption[] | undefined) =>
    `${options?.length ?? 0}보기${options?.some((o) => o.enabledWhen != null) ? '(보기조건)' : ''}`;
  let head: string;
  switch (c.type) {
    case 'text':
      return `글자${c.mobileDisplay ? `(${c.mobileDisplay})` : ''}${spanSuffix(c)}`;
    case 'input':
      head = `입력(${c.inputType ?? 'text'})`;
      break;
    case 'select':
      head = `선택 ${optionCount(c.selectOptions)}`;
      break;
    case 'radio':
      head = `라디오 ${optionCount(c.radioOptions)}`;
      break;
    case 'checkbox':
      head = `체크 ${optionCount(c.checkboxOptions)}`;
      break;
    case 'calc':
      head = c.calcValidation ? '계산 검증' : '계산';
      break;
    case 'choice_opt': {
      const group = (q.choiceGroups ?? []).find((g) => g.id === c.choiceGroupId);
      head = `보기 ${group?.groupKey ?? 'default'}=${choiceCode ?? c.spssNumericCode ?? '?'}`;
      break;
    }
    default:
      head = c.type;
  }
  const flags: string[] = [];
  if (c.required) flags.push('필수');
  if (c.enabledWhen != null) {
    const controllers = collectGateControllerIds(c.enabledWhen as CellEnableCondition).map(
      (id) => cellPosition(q, id) ?? '?',
    );
    flags.push(`열림←${controllers.join(',')}`);
  }
  if (c.requiredWhenEnabled) flags.push('열리면필수');
  if (c.numberFormat?.unit) flags.push(`단위=${c.numberFormat.unit}`);
  if (c.mobileLabel?.trim()) flags.push(`모바일「${clip(c.mobileLabel.trim(), 16)}」`);
  if (c.piiEncrypted) flags.push('암호화');
  return [head, ...flags].join(' ') + spanSuffix(c);
}

function describeConstraint(
  q: SummaryQuestion,
  sc: SummaryConstraint,
  byId: Map<string, SummaryQuestion>,
): string {
  const positions = (sc.cellIds ?? []).map((id) => cellPosition(q, id) ?? '?');
  const shown = positions.length > 4 ? `${positions.slice(0, 4).join(',')},…(${positions.length})` : positions.join(',');
  let target = String(sc.target ?? '?');
  if (sc.targetExpr?.kind === 'cell') {
    const src = sc.targetExpr.questionId ? byId.get(sc.targetExpr.questionId) : q;
    const position = src ? cellPosition(src, sc.targetExpr.cellId) : null;
    target = src && src !== q ? `${codeOf(src)}:${position ?? '?'}` : (position ?? '?');
  } else if (sc.targetExpr) target = '식';
  const applies = describeConditions(sc.whenQuestion, byId);
  return [
    `제약: ${sc.aggregate ?? 'sum'} ${OPERATORS[sc.operator ?? ''] ?? sc.operator ?? '?'} ${target} [${shown}]`,
    applies ? `적용 ${applies}` : '',
    sc.errorMessage ? `「${clip(oneLine(sc.errorMessage), 60)}」` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function describeQuestion(input: SummaryInput, questionCode: string): string[] {
  const questions = sorted(input);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const q = questions.find((x) => x.questionCode === questionCode);
  if (!q) {
    const codes = questions.map((x) => x.questionCode).filter(Boolean);
    throw new Error(`문항코드 ${questionCode} 가 없습니다. 있는 코드: ${codes.join(', ')}`);
  }

  const lines = [`${codeOf(q)} ${typeAndShape(q)} — ${clip(oneLine(q.title), 60)}`];
  const rest = summaryParts(q, byId).slice(1);
  if (rest.length > 0) lines.push(rest.join(' · '));

  const options = (q.options ?? []) as SummaryOption[];
  if (options.length > 0)
    lines.push(
      `보기: ${options
        .map((o) => `${o.spssNumericCode ?? '?'}=${o.value ?? '?'} ${clip(oneLine(o.label), 14)}`)
        .join(' | ')}`,
    );

  const columns = (q.tableColumns ?? []) as SummaryColumn[];
  if (columns.length > 0)
    lines.push(
      `열: ${columns
        .map((c, i) => {
          const condition = describeConditions(c.displayCondition, byId);
          return `${c.columnCode ?? `c${i + 1}`} ${clip(oneLine(c.label), 16)}${condition ? ` ←${condition}` : ''}`;
        })
        .join(' | ')}`,
    );

  const groups = q.choiceGroups ?? [];
  if (groups.length > 0)
    lines.push(
      `그룹: ${groups
        .map((g) => {
          const label = (g as { label?: string }).label;
          return `${g.groupKey ?? g.id} ${g.type ?? '?'} 「${clip(oneLine(label), 16)}」${g.required ? ' 필수' : ''}`;
        })
        .join(' · ')}`,
    );

  // 줄 — 같은 모양(보기 번호·칸 이름만 다른 줄)이 이어지면 한 줄로 접는다
  const rows = q.tableRowsData ?? [];
  const described = rows.map((r, ri) => {
    const cells = r.cells as SummaryCell[];
    // 줄 이름 — 맨 앞 칸이 글자 칸이면 그 글자(화면에 보이는 이름), 아니면 행 라벨. 입력 칸의 글자는
    // 단위(「명」)일 수 있어 이름으로 쓰지 않는다.
    const visible = cells.filter((c) => !c.isHidden);
    const leading = visible[0]?.type === 'text' ? oneLine(visible[0].content) : '';
    const anyText = visible.find((c) => c.type === 'text' && oneLine(c.content));
    const rowLabel = oneLine((r as { label?: string }).label);
    const condition = describeConditions(r.displayCondition, byId);
    return {
      code: r.rowCode ?? `r${ri + 1}`,
      title: clip(leading || rowLabel || oneLine(anyText?.content), 16),
      condition,
      signature: [condition, ...cells.map((c) => describeCell(q, withoutMobileLabel(c), 'N'))].join('|'),
      cells,
    };
  });
  for (let i = 0; i < described.length; ) {
    let j = i;
    while (j + 1 < described.length && described[j + 1]!.signature === described[i]!.signature) j += 1;
    const first = described[i]!;
    const last = described[j]!;
    const collapsed = j > i;
    const cellTexts = first.cells.map((c, ci) => {
      if (!collapsed || c.type !== 'choice_opt') return describeCell(q, c);
      const end = last.cells[ci]?.spssNumericCode ?? '?';
      return describeCell(q, c, `${c.spssNumericCode ?? '?'}…${end}`);
    });
    const head = collapsed
      ? `${first.code}~${last.code} (${j - i + 1}줄 같은 모양) ${first.title}`
      : `${first.code} ${first.title}`;
    lines.push(
      `${head}${first.condition ? ` ←${first.condition}` : ''} | ${cellTexts.join(' | ')}`,
    );
    i = j + 1;
  }

  for (const sc of (q.sumConstraints ?? []) as SummaryConstraint[])
    lines.push(describeConstraint(q, sc, byId));
  return lines;
}
