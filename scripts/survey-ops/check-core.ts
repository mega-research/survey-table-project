/**
 * 설문 구조 점검 — `pnpm survey:check` 의 코어. DB·파일을 모르는 순수 함수다.
 *
 * 오류 = 내보내기·응답이 깨진다(조립 스크립트는 여기서 멈춘다). 알림 = 조립 규칙과 다르다(일부러 그랬을 수 있다).
 * 규칙의 출처는 `docs/agents/survey-variable-rules.md` · `docs/agents/survey-screen-rules.md`.
 *
 * 구조 점검은 받은 그대로 보고, 값·코드 점검은 내보내기와 같은 사슬(normalize → hydrate)을 거친 뒤 본다 —
 * 보기·칸 코드는 파생이라 저장본에는 비어 있을 수 있다. 변수명 검증은 발행 게이트
 * (`server/survey-builder/services/survey-publish.ts`)와 같은 인자로 부른다.
 *
 * 해석할 줄 모르는 모양(값 대조를 못 하는 조건 유형 등)은 건너뛴다. 거짓 오류는 조립을 막는다.
 */
import { expandHeaderGrid } from '@/features/question-renderer/utils/expand-header-grid';
import { generateSPSSColumns, type SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { normalizeQuestions, QuestionVariantSchema, type QuestionVariant } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { assertValidSpssVarNames, isSpssVarNameError } from '@/lib/spss/variable-name-guard';
import { supportsChangeConfirmation } from '@/lib/survey/change-confirmation';
import type { CellEnableCondition, ChoiceGroup, QuestionGroup } from '@/types/survey';
import { collectGateControllerIds } from '@/utils/cell-gate-tree';
import { resolveChoiceCellGroup } from '@/utils/choice-group-helpers';
import { resolveLanguageSetLocales } from '@/utils/survey-language';

import { parseOpsFlags, type OpsEnv } from './env';

// ── 입력 모양 — 조립 산출물(out.json)과 DB 행이 같은 필드 이름을 쓴다 ─────────────────────────

interface RawOption {
  id?: string;
  label?: string;
  value?: string;
  spssNumericCode?: number | null;
  optionCode?: string | null;
  textInputOptional?: boolean;
  enabledWhen?: unknown;
}

interface RawCell {
  id: string;
  type: string;
  content?: string;
  isHidden?: boolean;
  rowspan?: number;
  colspan?: number;
  choiceGroupId?: string;
  choiceLabel?: string;
  spssNumericCode?: number | null;
  enabledWhen?: unknown;
  required?: boolean;
  requiredWhenEnabled?: boolean;
  textInputOptional?: boolean;
  inputType?: string;
  numberFormat?: { unit?: string } | null;
  mobileLabel?: string;
  formula?: unknown;
  calcValidation?: { target?: unknown } | null;
  radioOptions?: RawOption[];
  checkboxOptions?: RawOption[];
  selectOptions?: RawOption[];
  rankingOptions?: RawOption[];
}

interface RawCondition {
  enabled?: boolean;
  sourceQuestionId?: string;
  conditionType?: string;
  requiredValues?: string[];
  expressionConfig?: RawExpressionConfig;
}
/** `ExpressionConditionConfig`(types/survey) 의 느슨한 모양 — 저장본을 그대로 걷는다 */
interface RawExpressionConfig {
  clauses?: Array<{
    kind?: string;
    comparison?: { left?: RawOperand; right?: RawOperand };
    group?: RawExpressionConfig;
  }>;
}
interface RawOperand {
  kind?: string;
  questionId?: string;
  cellId?: string;
  left?: RawOperand;
  right?: RawOperand;
}
interface RawConditionGroup {
  conditions?: RawCondition[];
}
interface RawRow {
  id: string;
  rowCode?: string;
  cells: RawCell[];
  displayCondition?: RawConditionGroup | null;
}
interface RawColumn {
  id: string;
  columnCode?: string;
  displayCondition?: RawConditionGroup | null;
}
interface RawChoiceGroup {
  id: string;
  groupKey?: string;
  type?: string;
  required?: boolean;
}
interface RawSumConstraint {
  id?: string;
  cellIds?: string[];
  leftExpr?: unknown;
  targetExpr?: unknown;
  whenQuestion?: RawConditionGroup | null;
}

export interface RawQuestion {
  id: string;
  type: string;
  order: number;
  title?: string | null;
  required?: boolean | null;
  questionCode?: string | null;
  options?: RawOption[] | null;
  tableColumns?: RawColumn[] | null;
  tableRowsData?: RawRow[] | null;
  tableHeaderGrid?: unknown;
  choiceGroups?: RawChoiceGroup[] | null;
  sumConstraints?: RawSumConstraint[] | null;
  displayCondition?: RawConditionGroup | null;
  rankingConfig?: { requireAllPositions?: boolean } | null;
  rowRepeatConfig?: unknown;
  mobileTableDisplayMode?: string | null;
}

export interface CheckInput {
  questions: readonly RawQuestion[];
  groups?: readonly unknown[];
}

// ── 발견 ──────────────────────────────────────────────────────────────────────────────────

const FINDING_TITLES = {
  // 오류
  'row-cell-count': '행의 칸 수가 열 수와 다르다',
  merge: '병합이 맞지 않는다',
  'header-grid': '머리글 격자가 맞지 않는다',
  'group-orphan-cell': '보기 칸이 없는 보기 그룹을 가리킨다',
  'group-empty': '보기 칸이 하나도 없는 보기 그룹 정의가 남아 있다',
  'group-dup-code': '한 보기 그룹 안에서 응답값이 겹친다',
  'option-dup-key': '보기 저장 키가 겹친다',
  'option-dup-code': '보기 응답값이 겹친다',
  'multi-zero': '복수 선택 보기의 응답값이 0이다',
  'gate-ref': '열림 조건이 없는 칸을 가리킨다',
  'expr-ref': '수식·검증이 가리키는 칸이 잘못됐다',
  'cond-ref': '표시 조건이 가리키는 문항·값이 잘못됐다',
  'dup-id': 'id 가 겹친다',
  schema: '문항 계약(zod)을 통과하지 못한다',
  'var-name': 'SPSS 변수명 검증에 걸린다',
  'no-variables': '변수가 하나도 나가지 않는다',
  // 알림
  'dup-id-across': '다른 문항과 행·열·칸 id 가 겹친다',
  'key-vs-code': '보기 저장 키가 응답값과 다르다',
  'code-vs-number': '응답값이 변수번호와 다르다',
  'value-label-bytes': '값 라벨이 120바이트를 넘는다',
  'codes-not-two-digit': '행·열 코드가 두 자리 화면 순서가 아니다',
  'question-code': '문항코드가 없거나 소문자가 있다',
  'rank-partial': '순위형이 모든 순위 필수가 아니다',
  'other-optional': '기타 내용·조건으로 열리는 칸이 필수가 아니다',
  'column-group-required': '열 방향 보기 그룹에 필수가 걸려 안내가 줄 수만큼 되풀이된다',
  'amount-unit': '금액 칸에 단위 설정이 없다',
  'item-card-label': '항목 단위 카드 표의 응답 칸에 칸 이름이 없다',
} as const;

export type CheckFindingCode = keyof typeof FINDING_TITLES;

export interface CheckFinding {
  level: 'error' | 'notice';
  code: CheckFindingCode;
  /** 문항코드 — 없으면 제목 앞머리 */
  question: string;
  detail: string;
}

export interface CheckReport {
  findings: CheckFinding[];
  questionCount: number;
  variableCount: number;
  /** `--tsv` 가 쓴다 */
  columns: SPSSExportColumn[];
  hydrated: QuestionVariant[];
}

const VALUE_LABEL_BYTE_LIMIT = 120;
const INTERACTIVE_CELL_TYPES = new Set(['input', 'select', 'radio', 'checkbox', 'ranking']);
const AMOUNT_UNIT_TEXT = /(백만|천만|억|천|만)\s*원/;

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pad = (n: number, width: number) => String(n).padStart(width, '0');
const stripNulls = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

function questionLabel(q: RawQuestion): string {
  if (q.questionCode) return q.questionCode;
  const title = stripHtml(q.title ?? '');
  return title ? clip(title, 20) : q.id;
}

/** 열림 조건이 보는 칸 — 묶음(중첩)까지 푸는 것은 앱의 순회 모듈(`utils/cell-gate-tree`)에 맡긴다. */
function controllerCellIds(gate: unknown): string[] {
  if (gate == null || typeof gate !== 'object') return [];
  return collectGateControllerIds(gate as CellEnableCondition);
}

const ANSWER_CELL_TYPES = new Set([...INTERACTIVE_CELL_TYPES, 'choice_opt', 'ranking_opt', 'calc']);
function hasAnswerCells(q: RawQuestion): boolean {
  return (q.tableRowsData ?? []).some((r) =>
    r.cells.some((c) => !c.isHidden && ANSWER_CELL_TYPES.has(c.type)),
  );
}

function cellOptionLists(cell: RawCell): Array<{ kind: string; options: RawOption[] }> {
  const lists: Array<{ kind: string; options: RawOption[] }> = [];
  if (cell.radioOptions) lists.push({ kind: 'radio', options: cell.radioOptions });
  if (cell.checkboxOptions) lists.push({ kind: 'checkbox', options: cell.checkboxOptions });
  if (cell.selectOptions) lists.push({ kind: 'select', options: cell.selectOptions });
  if (cell.rankingOptions) lists.push({ kind: 'ranking', options: cell.rankingOptions });
  return lists;
}

export function checkSurveyStructure(input: CheckInput): CheckReport {
  const questions = [...input.questions].sort((a, b) => a.order - b.order);
  const findings: CheckFinding[] = [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const allCellIds = new Set<string>();
  for (const q of questions)
    for (const r of q.tableRowsData ?? []) for (const c of r.cells) allCellIds.add(c.id);

  const add = (
    level: CheckFinding['level'],
    code: CheckFindingCode,
    q: RawQuestion,
    detail: string,
  ) => findings.push({ level, code, question: questionLabel(q), detail });

  // ── 구조 (받은 그대로) ──
  // 응답은 문항 id 아래 칸 id 로 저장된다 — 한 문항 안의 중복은 값이 섞이고, 문항 사이의 중복은 손으로
  // 조립한 흔적이라 알리기만 한다(빌더의 복제는 id 를 새로 발번한다).
  const idOwners = new Map<string, RawQuestion>();
  const crossDuplicates = new Map<RawQuestion, number>();
  const claimId = (id: string | undefined, q: RawQuestion) => {
    if (!id) return;
    const owner = idOwners.get(id);
    if (!owner) idOwners.set(id, q);
    else if (owner === q || id === q.id || id === owner.id)
      add('error', 'dup-id', q, `id ${clip(id, 13)} 가 ${owner === q ? '이 문항 안에서' : questionLabel(owner) + ' 와'} 겹친다`);
    else crossDuplicates.set(q, (crossDuplicates.get(q) ?? 0) + 1);
  };

  for (const q of questions) {
    claimId(q.id, q);
    const columns = q.tableColumns ?? [];
    const rows = q.tableRowsData ?? [];
    const cells = rows.flatMap((r) => r.cells);
    const ownCellIds = new Set(cells.map((c) => c.id));
    for (const c of columns) claimId(c.id, q);

    for (const r of rows) {
      claimId(r.id, q);
      for (const c of r.cells) claimId(c.id, q);
      if (r.cells.length !== columns.length)
        add(
          'error',
          'row-cell-count',
          q,
          `${r.rowCode ?? r.id}: 칸 ${r.cells.length}개, 열 ${columns.length}개`,
        );
    }

    // 병합: 앵커가 덮는 칸은 전부 숨김이어야 하고, 숨김 칸은 어느 앵커에든 덮여야 한다
    const covered = new Set<string>();
    rows.forEach((r, ri) =>
      r.cells.forEach((c, ci) => {
        if (c.isHidden) return;
        for (let dr = 0; dr < (c.rowspan ?? 1); dr++)
          for (let dc = 0; dc < (c.colspan ?? 1); dc++) {
            if (dr === 0 && dc === 0) continue;
            const target = rows[ri + dr]?.cells[ci + dc];
            if (!target || !target.isHidden)
              add('error', 'merge', q, `${ri + 1}행 ${ci + 1}열의 병합이 덮는 칸이 숨김이 아니다`);
            else covered.add(target.id);
          }
      }),
    );
    const orphanHidden = cells.filter((c) => c.isHidden && !covered.has(c.id)).length;
    if (orphanHidden > 0)
      add('error', 'merge', q, `어느 병합에도 덮이지 않은 숨김 칸 ${orphanHidden}개`);

    if (Array.isArray(q.tableHeaderGrid) && q.tableHeaderGrid.length > 0) {
      try {
        const grid = new Set<string>();
        let overlap = false;
        for (const h of expandHeaderGrid(
          q.tableHeaderGrid as Parameters<typeof expandHeaderGrid>[0],
        ))
          for (let r = h.rowIdx; r < h.rowIdx + h.rowSpan; r++)
            for (let c = h.startCol; c < h.startCol + h.colSpan; c++) {
              if (grid.has(`${r}:${c}`)) overlap = true;
              grid.add(`${r}:${c}`);
            }
        if (overlap) add('error', 'header-grid', q, '머리글 칸이 겹친다');
        else if (grid.size !== columns.length * q.tableHeaderGrid.length)
          add(
            'error',
            'header-grid',
            q,
            `머리글 칸 ${grid.size}개, 열 ${columns.length} × ${q.tableHeaderGrid.length}줄`,
          );
      } catch (err) {
        add('error', 'header-grid', q, err instanceof Error ? err.message : String(err));
      }
    }

    // 보기 그룹
    const groups = q.choiceGroups ?? [];
    const groupIds = new Set(groups.map((g) => g.id));
    for (const g of groups) {
      claimId(g.id, q);
      const members = cells.filter((c) => c.choiceGroupId === g.id);
      if (members.length === 0) {
        add(
          'error',
          'group-empty',
          q,
          `${g.groupKey ?? g.id}: 그룹 정의를 지우지 않으면 이 문항 변수가 내보내기에서 빠질 수 있다`,
        );
        continue;
      }
      const memberCodes = members.map((c) => c.spssNumericCode).filter((v) => v != null);
      if (new Set(memberCodes).size !== memberCodes.length)
        add('error', 'group-dup-code', q, `${g.groupKey ?? g.id}`);

      // 열 방향 그룹(한 열에 세로로 놓인 보기)에 필수 → 미충족 안내가 줄 수만큼 되풀이된다
      const positions = members.map((m) => {
        const ri = rows.findIndex((r) => r.cells.includes(m));
        return { ri, ci: rows[ri]!.cells.indexOf(m) };
      });
      const oneColumn = new Set(positions.map((p) => p.ci)).size === 1;
      const manyRows = new Set(positions.map((p) => p.ri)).size >= 2;
      // 표 문항만 본다 — 보기 표를 내장한 단일·복수 선택은 그룹이 곧 문항이라 안내가 한 줄이다
      if (q.type === 'table' && oneColumn && manyRows && (g.required ?? q.required ?? false))
        add('notice', 'column-group-required', q, g.groupKey ?? g.id);
    }
    const orphanChoice = cells.filter(
      (c) => c.choiceGroupId && !groupIds.has(c.choiceGroupId),
    ).length;
    if (orphanChoice > 0) add('error', 'group-orphan-cell', q, `보기 칸 ${orphanChoice}개`);

    // 열림 조건이 가리키는 칸 — 평가기(`lib/survey/cell-gating`)는 그 문항의 칸 값만 읽는다.
    // 다른 문항의 칸을 가리키면 조건이 영영 충족되지 않아 칸이 닫힌 채 남는다.
    const gateRefs = cells.flatMap((c) => [
      ...controllerCellIds(c.enabledWhen),
      ...cellOptionLists(c).flatMap((l) => l.options.flatMap((o) => controllerCellIds(o.enabledWhen))),
    ]);
    const missingGate = new Set(gateRefs.filter((id) => !ownCellIds.has(id)));
    if (missingGate.size > 0) {
      const elsewhere = [...missingGate].filter((id) => allCellIds.has(id)).length;
      add(
        'error',
        'gate-ref',
        q,
        elsewhere > 0
          ? `이 문항에 없는 칸 ${missingGate.size}개 (그중 ${elsewhere}개는 다른 문항의 칸 — 열림 조건은 같은 문항만 읽는다)`
          : `이 문항에 없는 칸 ${missingGate.size}개`,
      );
    }

    // 수식·검증의 칸 참조 — 같은 문항이면 이 표의 칸, questionId 가 있으면 앞 문항의 칸
    const checkExpr = (expr: unknown, where: string) => {
      const walk = (e: unknown) => {
        if (!e || typeof e !== 'object') return;
        const node = e as {
          kind?: string;
          cellId?: string;
          questionId?: string;
          terms?: unknown[];
          items?: unknown[];
        };
        if (node.kind === 'cell') {
          if (node.questionId && node.questionId !== q.id) {
            const src = byId.get(node.questionId);
            if (!src) add('error', 'expr-ref', q, `${where}: 참조 문항이 없다`);
            else if (src.order > q.order)
              add('error', 'expr-ref', q, `${where}: 뒤 문항 ${questionLabel(src)} 의 칸을 본다`);
            else if (!(src.tableRowsData ?? []).some((r) => r.cells.some((c) => c.id === node.cellId)))
              add('error', 'expr-ref', q, `${where}: ${questionLabel(src)} 에 그 칸이 없다`);
          } else if (!node.cellId || !ownCellIds.has(node.cellId)) {
            add('error', 'expr-ref', q, `${where}: 이 표에 그 칸이 없다`);
          }
        }
        for (const t of node.terms ?? node.items ?? []) walk(t);
      };
      walk(expr);
    };
    for (const c of cells) {
      checkExpr(c.formula, '계산 칸');
      checkExpr(c.calcValidation?.target, '계산 칸 검증');
    }

    // 표시 조건 — 문항·열·행·검증 적용 조건
    const checkCond = (group: RawConditionGroup | null | undefined, where: string) => {
      for (const cond of group?.conditions ?? []) {
        // 꺼 둔 조건은 평가기(`utils/branch-logic`)가 건너뛴다 — 옛 참조가 남아 있어도 응답에 영향이 없다
        if (cond.enabled === false) continue;
        const conditionType = cond.conditionType ?? 'value-match';
        if (conditionType === 'expression') {
          // 원천 문항 칸을 비워 두고 식의 피연산자가 문항·칸을 가리킨다. 못 푸는 참조는 평가기가 거짓으로 본다.
          const problems = new Set<string>();
          const operand = (o: RawOperand | undefined) => {
            if (!o) return;
            if (o.kind === 'binop') {
              operand(o.left);
              operand(o.right);
            } else if (o.kind === 'cell' || o.kind === 'question') {
              const src = o.questionId ? byId.get(o.questionId) : undefined;
              if (!src) problems.add('식이 없는 문항을 본다');
              else if (src.order > q.order) problems.add(`식이 뒤 문항 ${questionLabel(src)} 를 본다`);
              else if (
                o.kind === 'cell' &&
                !(src.tableRowsData ?? []).some((r) => r.cells.some((c) => c.id === o.cellId))
              )
                problems.add(`식이 ${questionLabel(src)} 에 없는 칸을 본다`);
            }
          };
          const walkConfig = (config: RawExpressionConfig | undefined) => {
            for (const clause of config?.clauses ?? []) {
              operand(clause.comparison?.left);
              operand(clause.comparison?.right);
              walkConfig(clause.group);
            }
          };
          walkConfig(cond.expressionConfig);
          for (const problem of problems) add('error', 'cond-ref', q, `${where}: ${problem}`);
          continue;
        }
        // custom 은 뜻을 모른다 — 건드리지 않는다
        if (conditionType === 'custom') continue;
        const src = cond.sourceQuestionId ? byId.get(cond.sourceQuestionId) : undefined;
        if (!src) {
          add('error', 'cond-ref', q, `${where}: 원천 문항이 없다`);
          continue;
        }
        if (src.order > q.order) {
          add('error', 'cond-ref', q, `${where}: 뒤 문항 ${questionLabel(src)} 를 본다`);
          continue;
        }
        // 값 대조는 value-match 만 — 다른 유형은 값의 뜻이 달라 대조하지 않는다
        if (conditionType !== 'value-match') continue;
        const known = new Set<string>([
          ...(src.options ?? []).map((o) => o.value).filter((v): v is string => v != null),
          ...(src.tableRowsData ?? [])
            .flatMap((r) => r.cells)
            .filter((c) => c.type === 'choice_opt')
            .map((c) => c.id),
        ]);
        if (known.size === 0) continue;
        const missing = (cond.requiredValues ?? []).filter((v) => !known.has(v));
        if (missing.length > 0)
          add(
            'error',
            'cond-ref',
            q,
            `${where}: ${questionLabel(src)} 에 없는 값 ${missing.map((v) => `「${clip(v, 12)}」`).join(' ')}`,
          );
      }
    };
    checkCond(q.displayCondition, '문항 표시 조건');
    for (const c of columns) checkCond(c.displayCondition, `열 표시 조건(${c.columnCode ?? c.id})`);
    for (const r of rows) checkCond(r.displayCondition, `행 표시 조건(${r.rowCode ?? r.id})`);
    for (const sc of q.sumConstraints ?? []) {
      claimId(sc.id, q);
      const missingCells = (sc.cellIds ?? []).filter((id) => !ownCellIds.has(id)).length;
      if (missingCells > 0) add('error', 'expr-ref', q, `합계 제약: 이 표에 없는 칸 ${missingCells}개`);
      checkExpr(sc.leftExpr, '합계 제약');
      checkExpr(sc.targetExpr, '합계 제약');
      checkCond(sc.whenQuestion, '검증 적용 조건');
    }

    // ── 조립 규칙 (알림) ──
    if (rows.length > 0 && !q.rowRepeatConfig) {
      const rowWidth = Math.max(2, String(rows.length).length);
      const colWidth = Math.max(2, String(columns.length).length);
      const badRow = rows.find((r, i) => r.rowCode !== `r${pad(i + 1, rowWidth)}`);
      const badCol = columns.find((c, i) => c.columnCode !== `c${pad(i + 1, colWidth)}`);
      if (badRow || badCol)
        add(
          'notice',
          'codes-not-two-digit',
          q,
          [badRow && `행 ${badRow.rowCode ?? '(없음)'}`, badCol && `열 ${badCol.columnCode ?? '(없음)'}`]
            .filter(Boolean)
            .join(' · '),
        );
    }

    if (q.type === 'ranking' && q.rankingConfig?.requireAllPositions !== true)
      add('notice', 'rank-partial', q, '「모든 순위 입력 필수」가 꺼져 있다');

    const visibleCells = cells.filter((c) => !c.isHidden);
    const optionalText =
      (q.options ?? []).filter((o) => o.textInputOptional).length +
      visibleCells.filter(
        (c) =>
          c.textInputOptional || cellOptionLists(c).some((l) => l.options.some((o) => o.textInputOptional)),
      ).length;
    const gatedNotRequired = visibleCells.filter(
      (c) =>
        (c.type === 'input' || c.type === 'select') &&
        c.enabledWhen != null &&
        !c.required &&
        !c.requiredWhenEnabled,
    ).length;
    if (optionalText + gatedNotRequired > 0)
      add(
        'notice',
        'other-optional',
        q,
        [
          optionalText > 0 && `내용 선택 입력 ${optionalText}곳`,
          gatedNotRequired > 0 && `열려도 필수가 아닌 칸 ${gatedNotRequired}개`,
        ]
          .filter(Boolean)
          .join(' · '),
      );

    const amountWithoutUnit = visibleCells.filter(
      (c) =>
        c.type === 'input' &&
        c.inputType === 'number' &&
        AMOUNT_UNIT_TEXT.test(c.content ?? '') &&
        !c.numberFormat?.unit,
    ).length;
    if (amountWithoutUnit > 0) add('notice', 'amount-unit', q, `칸 ${amountWithoutUnit}개`);

    if (q.mobileTableDisplayMode === 'item-cards') {
      // 앞에 이름 칸(글자 칸, 또는 위에서 내려온 병합에 가려진 칸)이 있으면 그 글자가 카드 제목이 된다.
      // 이름 칸 없이 응답 칸만 놓인 줄(머리글 아래 한 줄 입력 표)은 칸 이름이 유일한 제목이다.
      let unlabeled = 0;
      for (const r of rows) {
        let named = false;
        for (const c of r.cells) {
          if (c.isHidden || (c.type === 'text' && (c.content ?? '').trim())) named = true;
          else if (INTERACTIVE_CELL_TYPES.has(c.type) && !named && !c.mobileLabel?.trim())
            unlabeled += 1;
        }
      }
      if (unlabeled > 0) add('notice', 'item-card-label', q, `칸 ${unlabeled}개`);
    }
  }

  for (const [q, count] of crossDuplicates)
    add('notice', 'dup-id-across', q, `행·열·칸 id ${count}개`);

  // ── 문항 계약 ──
  for (const q of questions) {
    const parsed = QuestionVariantSchema.safeParse(stripNulls(q));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      add('error', 'schema', q, issue ? `${issue.path.join('.')}: ${issue.message}` : 'zod 실패');
    }
  }

  // ── 변수명 — 발행 게이트와 같은 사슬·같은 인자 ──
  const hydrated = hydrateQuestionsForSpss(normalizeQuestions(questions.map(stripNulls)));
  const surveyGroups = (input.groups ?? []).map((g) => stripNulls(g as object)) as unknown as QuestionGroup[];
  const columns = generateSPSSColumns(hydrated, {
    changeConfirmQuestionIds: new Set(hydrated.filter(supportsChangeConfirmation).map((q) => q.id)),
    languageSetLocales: resolveLanguageSetLocales(hydrated, surveyGroups),
  });
  const structureColumns = generateSPSSColumns(hydrated, {
    languageSetLocales: resolveLanguageSetLocales(hydrated, surveyGroups),
  });
  try {
    assertValidSpssVarNames(columns);
  } catch (err) {
    if (!isSpssVarNameError(err)) throw err;
    for (const issue of err.issues)
      findings.push({
        level: 'error',
        code: 'var-name',
        question: issue.varName,
        detail: issue.reason,
      });
  }

  // 문항별 열 수는 언어 묶음을 합치기 전으로 센다 — 합치면 둘째 언어 문항의 열이 첫 언어 문항 것이 된다
  const variableCounts = new Map<string, number>();
  for (const c of generateSPSSColumns(hydrated))
    variableCounts.set(c.questionId, (variableCounts.get(c.questionId) ?? 0) + 1);
  for (const q of questions) {
    if (q.type === 'notice' || variableCounts.get(q.id)) continue;
    // 응답 칸이 하나도 없는 표는 보여 주기만 하는 표다(코드표 등) — 변수도 문항코드도 없는 것이 맞다
    if (q.type === 'table' && !hasAnswerCells(q)) continue;
    add('error', 'no-variables', q, `${q.type} 문항인데 내보내기 열이 0개다`);
  }
  for (const q of questions) {
    if (q.type === 'notice' || !variableCounts.get(q.id)) continue;
    if (!q.questionCode) add('notice', 'question-code', q, '문항코드가 없다');
    else if (/[a-z]/.test(q.questionCode))
      add('notice', 'question-code', q, '소문자가 있다 — 태그(opt·r·c)와 겹친다');
  }

  // ── 값·코드 (hydrate 뒤) ──
  for (const hq of hydrated) {
    const raw = byId.get(hq.id);
    if (!raw) continue;
    const h = hq as unknown as RawQuestion;
    const cells = (h.tableRowsData ?? []).flatMap((r) => r.cells).filter((c) => !c.isHidden);
    const hasChoiceCells = cells.some((c) => c.type === 'choice_opt');

    const lists: Array<{ kind: string; options: RawOption[] }> = [];
    // 다단계 선택은 저장 키가 경로이고, 보기 소스 표 문항은 응답값이 칸 id 다 — 보기 목록을 대조하지 않는다
    if (h.type !== 'multiselect' && !(hasChoiceCells && h.type !== 'table'))
      lists.push({ kind: h.type, options: h.options ?? [] });
    for (const c of cells) lists.push(...cellOptionLists(c));

    let keyMismatch = 0;
    let numberMismatch = 0;
    const longLabels: string[] = [];
    const flags = new Set<CheckFindingCode>();
    for (const { kind, options } of lists) {
      const keys = options.map((o) => o.value).filter((v) => v != null);
      if (new Set(keys).size !== keys.length) flags.add('option-dup-key');
      const optionCodes = options.map((o) => o.spssNumericCode).filter((v) => v != null);
      if (new Set(optionCodes).size !== optionCodes.length) flags.add('option-dup-code');
      for (const o of options) {
        if (kind === 'checkbox' && o.spssNumericCode === 0) flags.add('multi-zero');
        if (o.spssNumericCode != null && o.value != null) {
          const sameNumber = /^\d+$/.test(o.value) && Number(o.value) === o.spssNumericCode;
          if (!sameNumber) keyMismatch += 1;
        }
        // 변수번호가 변수명에 나오는 것은 복수 선택뿐이다(`B2_opt05` 안에 97) — 단일 선택은 보지 않는다
        const numberPart = o.optionCode?.match(/(\d+)$/)?.[1];
        if (
          kind === 'checkbox' &&
          o.spssNumericCode != null &&
          numberPart != null &&
          Number(numberPart) !== o.spssNumericCode
        )
          numberMismatch += 1;
        const label = stripHtml(o.label ?? '');
        const bytes = Buffer.byteLength(label);
        if (bytes > VALUE_LABEL_BYTE_LIMIT) longLabels.push(`「${clip(label, 14)}」 ${bytes}바이트`);
      }
    }
    // 보기 칸의 선택 방식은 앱의 판정 한 곳에 묻는다 — 그룹에 속하면 그 종류, 그룹 없는 보기 소스 표는
    // 문항 유형을 따른다(테이블 유형의 그룹 없는 보기 칸은 답할 수 없는 칸이라 null).
    const defaultChoiceType = h.type === 'table' ? null : h.type === 'checkbox' ? 'checkbox' : 'radio';
    const choiceGroups = (h.choiceGroups ?? []) as unknown as ChoiceGroup[];
    for (const c of cells) {
      if (c.type !== 'choice_opt') continue;
      const { type: choiceType } = resolveChoiceCellGroup(c, choiceGroups, defaultChoiceType);
      if (choiceType === 'checkbox' && c.spssNumericCode === 0) flags.add('multi-zero');
      const label = stripHtml(c.choiceLabel ?? '');
      const bytes = Buffer.byteLength(label);
      if (bytes > VALUE_LABEL_BYTE_LIMIT) longLabels.push(`「${clip(label, 14)}」 ${bytes}바이트`);
    }

    for (const code of flags) add('error', code, raw, FINDING_TITLES[code]);
    if (keyMismatch > 0) add('notice', 'key-vs-code', raw, `보기 ${keyMismatch}개`);
    if (numberMismatch > 0) add('notice', 'code-vs-number', raw, `보기 ${numberMismatch}개`);
    if (longLabels.length > 0) add('notice', 'value-label-bytes', raw, longLabels.join(' · '));
  }

  return {
    findings,
    questionCount: questions.length,
    variableCount: structureColumns.length,
    columns: structureColumns,
    hydrated,
  };
}

// ── 출력 ──────────────────────────────────────────────────────────────────────────────────

const PER_CODE_LIMIT = 12;

/** 점검 종류별로 묶는다 — 종류마다 한 줄, 그 아래 문항별 한 줄(상한 12). 오류가 먼저다. */
export function formatCheckReport(title: string, report: CheckReport): string {
  const errors = report.findings.filter((f) => f.level === 'error');
  const notices = report.findings.filter((f) => f.level === 'notice');
  const lines = [
    `${title} — 문항 ${report.questionCount} · 변수 ${report.variableCount}`,
    `오류 ${errors.length}건 · 알림 ${notices.length}건`,
  ];
  const section = (tag: string, list: CheckFinding[]) => {
    const byCode = new Map<CheckFindingCode, CheckFinding[]>();
    for (const f of list) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);
    for (const [code, items] of byCode) {
      const byQuestion = new Map<string, string[]>();
      for (const f of items)
        byQuestion.set(f.question, [...(byQuestion.get(f.question) ?? []), f.detail]);
      lines.push(`[${tag}] ${FINDING_TITLES[code]} — ${byQuestion.size}문항`);
      const entries = [...byQuestion];
      for (const [question, details] of entries.slice(0, PER_CODE_LIMIT))
        lines.push(`  ${question}: ${clip([...new Set(details)].join(' / '), 160)}`);
      if (entries.length > PER_CODE_LIMIT)
        lines.push(`  … 외 ${entries.length - PER_CODE_LIMIT}문항`);
    }
  };
  section('오류', errors);
  section('알림', notices);
  return lines.join('\n');
}

// ── 인자 ──────────────────────────────────────────────────────────────────────────────────

export type CheckSource =
  | { kind: 'file'; path: string; tsv: string | undefined }
  | { kind: 'db'; surveyId: string; env: OpsEnv; tsv: string | undefined };

/** `--file` 이면 DB 에 붙지 않으므로 `--env` 를 요구하지 않는다. 설문 id 면 다른 명령처럼 꼭 적는다. */
export function parseCheckArgs(argv: readonly string[]): CheckSource {
  const { flags, positionals } = parseOpsFlags(argv);
  const tsvFlag = flags.get('tsv');
  const tsv = typeof tsvFlag === 'string' ? tsvFlag : undefined;
  const file = flags.get('file');
  if (typeof file === 'string') return { kind: 'file', path: file, tsv };

  const surveyId = positionals[0];
  if (!surveyId)
    throw new Error(
      '설문 id 또는 --file 을 적어 주세요: pnpm survey:check <surveyId> --env prod | --file <out.json>',
    );
  const env = flags.get('env');
  if (env !== 'prod' && env !== 'local')
    throw new Error(
      '--env prod 또는 --env local 을 꼭 적어 주세요 (어느 DB 에 붙을지 기본값을 두지 않습니다)',
    );
  return { kind: 'db', surveyId, env, tsv };
}
