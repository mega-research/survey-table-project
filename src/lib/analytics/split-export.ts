import type { Question, QuestionConditionGroup } from '@/types/survey';

import { generateSPSSColumns } from './spss-excel-export';

export const SPLIT_SOFT_LIMIT = 10000;
export const SPLIT_EXCEL_LIMIT = 16384;
export const SPLIT_RESERVED_SHEET_NAMES = ['응답 내역', '공통', '코딩북'];

/** displayCondition 중 basisId를 value-match 하는 조건의 requiredValues 합집합. 없으면 null.
 * 부정 그룹(dc.logicType === 'NOT'), 비활성 조건(enabled === false),
 * 부정 단위 조건(c.logicType === 'NOT')은 양성 매치로 보지 않아 null 반환. */
export function valueMatchSet(
  dc: QuestionConditionGroup | undefined,
  basisId: string,
): Set<string> | null {
  if (!dc || !Array.isArray(dc.conditions)) return null;
  if (dc.logicType === 'NOT') return null; // 부정 그룹 → 양성 매치 아님
  let s: Set<string> | null = null;
  for (const c of dc.conditions) {
    if (
      c.enabled !== false &&
      c.conditionType === 'value-match' &&
      c.logicType !== 'NOT' &&
      c.sourceQuestionId === basisId &&
      Array.isArray(c.requiredValues) &&
      c.requiredValues.length > 0
    ) {
      s = s ?? new Set<string>();
      for (const v of c.requiredValues) s.add(v);
    }
  }
  return s;
}

/** bucket('common' | 옵션토큰)에 속한 질문/행만 남긴 복사본 리스트 */
export function bucketQuestions(
  questions: Question[],
  basisId: string,
  bucket: string,
): Question[] {
  const out: Question[] = [];
  for (const q of questions) {
    const qset = valueMatchSet(q.displayCondition, basisId);
    if (bucket === 'common') {
      if (qset !== null) continue; // 옵션 전용 질문
      if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
        const rows = q.tableRowsData.filter(
          (r) => valueMatchSet(r.displayCondition, basisId) === null,
        );
        if (rows.length === 0) continue;
        out.push({ ...q, tableRowsData: rows });
      } else {
        out.push(q);
      }
    } else {
      if (qset !== null && !qset.has(bucket)) continue; // 다른 옵션 전용
      if (qset !== null) {
        out.push(q); // 이 옵션 전용 질문 → 전체 행
      } else if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
        const rows = q.tableRowsData.filter((r) => {
          const rs = valueMatchSet(r.displayCondition, basisId);
          return rs !== null && rs.has(bucket);
        });
        if (rows.length === 0) continue;
        out.push({ ...q, tableRowsData: rows });
      }
      // 공통 비테이블 질문은 옵션 시트에 넣지 않음(공통 시트로 감)
    }
  }
  return out;
}

/** displayCondition들에 실제 등장하는 basis 옵션 토큰을, options 순서로 정렬해 반환 */
export function optionTokensForBasis(questions: Question[], basis: Question): string[] {
  const present = new Set<string>();
  for (const q of questions) {
    const qs = valueMatchSet(q.displayCondition, basis.id);
    qs?.forEach((t) => present.add(t));
    if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
      for (const r of q.tableRowsData) {
        valueMatchSet(r.displayCondition, basis.id)?.forEach((t) => present.add(t));
      }
    }
  }
  const ordered: string[] = [];
  for (const o of basis.options ?? []) {
    if (present.has(o.value)) {
      ordered.push(o.value);
      present.delete(o.value);
    }
  }
  for (const t of present) ordered.push(t); // 옵션 목록에 없는 토큰(other 등)
  return ordered;
}

export interface SplitSheetPlan {
  token: string;
  name: string;
  vars: number;
  resp: number;
}

export interface SplitPlan {
  basisQuestionId: string;
  basisCode: string;
  basisLabel: string;
  common: number;
  sheets: SplitSheetPlan[];
  maxVars: number;
  exceedsSoftLimit: boolean;
  exceedsExcelLimit: boolean;
}

/** 식별자 열 1개를 더한 실제 열 수가 Excel 한계를 넘는지 */
export function splitPlanExceedsExcelLimit(maxVars: number): boolean {
  return maxVars + 1 > SPLIT_EXCEL_LIMIT;
}

export function planSplit(
  questions: Question[],
  basisQuestionId: string,
  respCounts: Record<string, number> = {},
): SplitPlan {
  const basis = questions.find((q) => q.id === basisQuestionId);
  if (!basis) throw new Error(`기준 문항을 찾을 수 없습니다: ${basisQuestionId}`);

  const labelMap = new Map((basis.options ?? []).map((o) => [o.value, o.label]));
  const tokens = optionTokensForBasis(questions, basis);

  const common = generateSPSSColumns(bucketQuestions(questions, basisQuestionId, 'common')).length;

  const rawSheets: Array<{ token: string; rawName: string; vars: number; resp: number }> = [];
  for (const t of tokens) {
    const vars = generateSPSSColumns(bucketQuestions(questions, basisQuestionId, t)).length;
    if (vars === 0) continue; // 빈 버킷 제외
    rawSheets.push({ token: t, rawName: labelMap.get(t) ?? t, vars, resp: respCounts[t] ?? 0 });
  }

  const finalNames = assignSplitSheetNames(
    rawSheets.map((s) => s.rawName),
    SPLIT_RESERVED_SHEET_NAMES,
  );
  const sheets: SplitSheetPlan[] = rawSheets.map((s, i) => ({
    token: s.token,
    name: finalNames[i],
    vars: s.vars,
    resp: s.resp,
  }));

  const maxVars = Math.max(common, 0, ...sheets.map((s) => s.vars));
  return {
    basisQuestionId,
    basisCode: basis.questionCode ?? '',
    basisLabel: basis.title,
    common,
    sheets,
    maxVars,
    exceedsSoftLimit: maxVars > SPLIT_SOFT_LIMIT,
    exceedsExcelLimit: splitPlanExceedsExcelLimit(maxVars),
  };
}

/** Excel 시트명 제약(31자, []:*?/\ 제거)을 적용하고, 중복은 ~N 접미사로 유일화한다. 입력 순서 보존.
 * reserved 목록은 사전 예약 시트명으로, 해당 이름은 이미 사용된 것으로 간주하되 출력에 포함되지 않는다. */
export function assignSplitSheetNames(rawNames: string[], reserved: string[] = []): string[] {
  const used = new Set<string>(reserved);
  return rawNames.map((raw) => {
    const base =
      (raw || '')
        .replace(/[[\]:*?/\\]/g, ' ')
        .trim()
        .slice(0, 31) || '시트';
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      const suf = `~${n++}`;
      candidate = base.slice(0, 31 - suf.length) + suf;
    }
    used.add(candidate);
    return candidate;
  });
}

const SPLIT_BASIS_TYPES = ['radio', 'checkbox', 'select', 'multiselect'];

export interface SplitCandidate {
  questionId: string;
  code: string;
  label: string;
  type: string;
  refCount: number;
  buckets: number;
  maxVars: number;
  recommended: boolean;
  note: string;
}

export function detectSplitCandidates(questions: Question[]): SplitCandidate[] {
  // 1) value-match sourceQuestionId 빈도 집계 (질문 + 테이블 행)
  const refCount = new Map<string, number>();
  const bump = (dc: QuestionConditionGroup | undefined) => {
    if (!dc || !Array.isArray(dc.conditions)) return;
    if (dc.logicType === 'NOT') return; // 부정 그룹은 양성 value-match 로 집계 안 함
    for (const c of dc.conditions) {
      if (
        c.enabled !== false &&
        c.conditionType === 'value-match' &&
        c.logicType !== 'NOT' &&
        c.sourceQuestionId &&
        Array.isArray(c.requiredValues) &&
        c.requiredValues.length > 0
      ) {
        refCount.set(c.sourceQuestionId, (refCount.get(c.sourceQuestionId) ?? 0) + 1);
      }
    }
  };
  for (const q of questions) {
    bump(q.displayCondition);
    if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
      for (const r of q.tableRowsData) bump(r.displayCondition);
    }
  }

  // 2) 후보 생성
  const qmap = new Map(questions.map((q) => [q.id, q]));
  const candidates: SplitCandidate[] = [];
  for (const [qid, refs] of refCount) {
    const basis = qmap.get(qid);
    if (!basis || !SPLIT_BASIS_TYPES.includes(basis.type)) continue;
    const plan = planSplit(questions, qid);
    if (plan.sheets.length < 2) continue; // 분할 효과 없음
    candidates.push({
      questionId: qid,
      code: basis.questionCode ?? '',
      label: basis.title,
      type: basis.type,
      refCount: refs,
      buckets: plan.sheets.length,
      maxVars: plan.maxVars,
      recommended: false,
      note: '',
    });
  }

  // 3) 정렬: maxVars 작을수록 → buckets 적을수록
  candidates.sort((a, b) => a.maxVars - b.maxVars || a.buckets - b.buckets);

  // 4) 권장 + note
  for (const c of candidates) {
    c.recommended = c.maxVars <= SPLIT_SOFT_LIMIT;
    if (c.maxVars <= SPLIT_SOFT_LIMIT) {
      c.note =
        c.buckets >= 10
          ? `시트가 ${c.buckets}개로 많지만 시트당 변수는 가장 적음`
          : '분기 경계가 깔끔해 시트 변수가 고르게 작아짐';
    } else if (c.maxVars <= SPLIT_EXCEL_LIMIT) {
      c.note = '일부 시트가 한계에 근접';
    } else {
      c.note = '일부 시트가 Excel 한계를 초과';
    }
  }
  // 모두 임계 초과면 1순위에만 권장
  if (!candidates.some((c) => c.recommended) && candidates[0]) candidates[0].recommended = true;

  return candidates;
}
