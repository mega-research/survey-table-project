'use client';

import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { AlertTriangle } from 'lucide-react';

import { extractVariableKeys } from '@/lib/mail/variable-extractor';
import { QUESTION_LIKE_CELL_TYPES } from '@/lib/survey/answer-quote';
import { formatCellLabel } from '@/utils/cell-label';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { resolveRankingOptions } from '@/utils/ranking-source';
import type { VariableDef } from '@/components/operations/mail-template/variable-catalog';
import type { Question, QuestionGroup, TableCell } from '@/types/survey';

interface Props {
  questions: Question[];
  groups: QuestionGroup[];
  thankYouMessage: string;
  catalog: VariableDef[];
}

/**
 * `{{{인용이름}}}` 토큰만 추출한다. 컨택 `{{키}}` 와는 다른 채널이라
 * lib/mail/variable-extractor 의 `[^}]+` 패턴을 그대로 쓰면 안 된다 — 그 패턴은
 * 여는 중괄호까지 삼켜 삼중 중괄호를 망가뜨린다(substitute-tokens.ts 참조).
 */
const QUOTE_TOKEN_PATTERN = /\{\{\{([^{}]+)\}\}\}/g;

function extractQuoteTokens(...sources: (string | undefined)[]): string[] {
  const set = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    QUOTE_TOKEN_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUOTE_TOKEN_PATTERN.exec(s)) !== null) {
      const key = m[1];
      if (key !== undefined) set.add(key.trim());
    }
  }
  return Array.from(set);
}

/**
 * 질문 하나가 응답 페이지에서 "치환되는" 자리에 노출하는 문자열 전부.
 * substituteTokens 호출처를 훑어 도출한 표면 — question-input.tsx(title/description/
 * notice/option.label), ranking-question.tsx/ranking-dropdown-stack.tsx(ranking 옵션),
 * cells/*.tsx(표 셀 content 와 radioOptions/checkboxOptions/selectOptions/rankingOptions).
 * choice_opt/ranking_opt 셀은 resolveChoiceOptions/resolveRankingOptions 가 이미 라벨을
 * 흡수하므로 표 순회에서 건너뛴다(이중 집계 방지, lib/survey/answer-quote.ts
 * collectAnswerQuotes 의 QUESTION_LIKE_CELL_TYPES 필터와 동일 원칙).
 *
 * prefill 템플릿(defaultValueTemplate)은 질문 레벨이든 표 셀이든 여기 포함하지 않는다 —
 * 둘 다 attrs 만 치환한다. prefill 결과는 응답으로 저장되는데 응답 인용은 저장되지 않는
 * 파생값이라 채널을 섞지 않는다(경고 4 — nonSubstitutedFindings 참조).
 */
function substitutedSourcesOf(q: Question): (string | undefined)[] {
  const sources: (string | undefined)[] = [q.title, q.description, q.noticeContent];

  if (q.type === 'radio' || q.type === 'checkbox') {
    for (const opt of resolveChoiceOptions(q)) sources.push(opt.label);
  } else if (q.type === 'select') {
    for (const opt of q.options ?? []) sources.push(opt.label);
  } else if (q.type === 'multiselect') {
    for (const level of q.selectLevels ?? []) {
      for (const opt of level.options ?? []) sources.push(opt.label);
    }
  } else if (q.type === 'ranking') {
    for (const opt of resolveRankingOptions(q)) sources.push(opt.label);
  }

  for (const row of q.tableRowsData ?? []) {
    for (const cell of row.cells) {
      if (cell.type === 'choice_opt' || cell.type === 'ranking_opt') continue;
      sources.push(cell.content);
      if (cell.type === 'radio') for (const o of cell.radioOptions ?? []) sources.push(o.label);
      if (cell.type === 'checkbox') for (const o of cell.checkboxOptions ?? []) sources.push(o.label);
      if (cell.type === 'select') for (const o of cell.selectOptions ?? []) sources.push(o.label);
      if (cell.type === 'ranking') for (const o of cell.rankingOptions ?? []) sources.push(o.label);
    }
  }

  return sources;
}

/** 인용을 켠 질문이 실제로 인용될 문구를 하나라도 갖고 있는지 (모두 빈 문구면 항상 빈 문자열). */
function hasAnyQuoteText(q: Question): boolean {
  if (q.type === 'text') return !!(q.answerQuoteText ?? '').trim();

  const optionTexts: (string | undefined)[] = [];
  if (q.type === 'radio' || q.type === 'checkbox') {
    for (const opt of resolveChoiceOptions(q)) optionTexts.push(opt.answerQuoteText);
  } else if (q.type === 'select') {
    for (const opt of q.options ?? []) optionTexts.push(opt.answerQuoteText);
  } else if (q.type === 'multiselect') {
    for (const level of q.selectLevels ?? []) {
      for (const opt of level.options ?? []) optionTexts.push(opt.answerQuoteText);
    }
  } else if (q.type === 'ranking') {
    for (const opt of resolveRankingOptions(q)) optionTexts.push(opt.answerQuoteText);
  }
  return optionTexts.some((t) => (t ?? '').trim());
}

/**
 * 셀 하나가 실제로 인용될 문구를 하나라도 갖고 있는지 (모두 빈 문구면 항상 빈 문자열).
 * hasAnyQuoteText 의 셀 버전 — 셀은 자기 이름으로 독립 정의되므로 같은 표의 다른 셀에
 * 문구가 있어도 이 셀 자신이 비어 있으면 여전히 빈 문자열로 치환된다.
 */
function cellHasQuoteText(cell: TableCell): boolean {
  if (cell.type === 'input') return !!(cell.answerQuoteText ?? '').trim();
  if (cell.type === 'radio') return (cell.radioOptions ?? []).some((o) => (o.answerQuoteText ?? '').trim());
  if (cell.type === 'checkbox') return (cell.checkboxOptions ?? []).some((o) => (o.answerQuoteText ?? '').trim());
  if (cell.type === 'select') return (cell.selectOptions ?? []).some((o) => (o.answerQuoteText ?? '').trim());
  if (cell.type === 'ranking') return (cell.rankingOptions ?? []).some((o) => (o.answerQuoteText ?? '').trim());
  return false; // choice_opt/ranking_opt — 이름을 갖지 않는 옵션 셀
}

interface QuoteReference {
  name: string;
  /** null = 순서 비교 불가(소속 질문이 없는 그룹) — 미정의 이름 경고에만 쓴다. */
  order: number | null;
  label: string;
  /** 참조가 속한 질문 — 표 셀끼리(같은 표 안)는 순서 비교가 성립하지 않아 제외할 때만 쓴다. */
  questionId: string | null;
}

interface QuoteSource {
  name: string;
  /** 셀 출처는 자기 order 가 없다 — 호스트 질문의 order 를 그대로 쓴다. */
  order: number;
  label: string;
  /** 이 이름을 정의한 질문 — 표 셀끼리(같은 표 안)는 순서 비교가 성립하지 않아 제외할 때만 쓴다. */
  questionId: string;
  scope: 'question' | 'cell';
  hasText: boolean;
}

/**
 * 그룹 자신 + 모든 하위 그룹(재귀)에 속한 질문들의 order 를 전부 모은다.
 * 순서 위반 판정에 쓸 그룹의 "유효 order"(= 그 안 어딘가에 있는 질문 중 가장 이른 order)를
 * 구하기 위함 — 직계 질문만 보면 하위그룹에만 질문이 있는 그룹(직계 질문 0개)의 위반을
 * 놓친다. 순환 parentGroupId(잘못된 데이터)에도 무한루프에 빠지지 않도록 visited 로 가드.
 */
function collectDescendantQuestionOrders(
  rootGroupId: string,
  questions: Question[],
  groups: QuestionGroup[],
): number[] {
  const orders: number[] = [];
  const visited = new Set<string>();
  const stack: string[] = [rootGroupId];
  while (stack.length > 0) {
    const groupId = stack.pop();
    if (groupId === undefined || visited.has(groupId)) continue;
    visited.add(groupId);
    for (const q of questions) {
      if (q.groupId === groupId) orders.push(q.order);
    }
    for (const g of groups) {
      if (g.parentGroupId === groupId && !visited.has(g.id)) stack.push(g.id);
    }
  }
  return orders;
}

function toneClasses(tone: 'amber' | 'red'): string {
  return tone === 'red'
    ? 'border-red-300 bg-red-50 text-red-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';
}

function WarningBox({
  tone,
  title,
  children,
}: {
  tone: 'amber' | 'red';
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${toneClasses(tone)}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">{title}</div>
        {children}
      </div>
    </div>
  );
}

/**
 * 본문에 사용된 토큰(컨택 컬럼 · 응답 인용) 중 설정 실수로 의심되는 경우 경고.
 * - hard error 아님 — 전부 빈 문자열로 치환되므로 동작은 가능. 저장/발행을 막지 않는다.
 * - 응답 인용 이름 중복(경고 대상 아님 — 여러 질문이 같은 이름에 합류하는 것은 의도된 동작)과
 *   컨택 컬럼명 충돌(중괄호 문법이 달라 애초에 충돌 불가능)은 여기서 다루지 않는다.
 */
export function TokenWarningPanel({ questions, groups, thankYouMessage, catalog }: Props) {
  const knownKeys = useMemo(
    () => new Set(catalog.filter((v) => v.category === 'attrs').map((v) => v.key)),
    [catalog],
  );

  const unknownContactKeys = useMemo(() => {
    if (catalog.length === 0) return [];
    const sources: string[] = [];
    for (const q of questions) {
      if (q.description) sources.push(q.description);
      if (q.noticeContent) sources.push(q.noticeContent);
      if (q.defaultValueTemplate) sources.push(q.defaultValueTemplate);
      if (q.tableRowsData) {
        for (const row of q.tableRowsData) {
          for (const cell of row.cells) {
            if (cell.content) sources.push(cell.content);
            if (cell.defaultValueTemplate) sources.push(cell.defaultValueTemplate);
          }
        }
      }
    }
    const usedKeys = extractVariableKeys(...sources);
    return usedKeys.filter((k) => !knownKeys.has(k));
  }, [questions, knownKeys, catalog]);

  // 인용을 정의한 이름 전부 — collectAnswerQuotes 와 동일 기준으로 두 경로를 합친다.
  // 비활성(answerQuoteEnabled=false)이면 아무 것도 기여하지 않으므로 "정의 없음"과 같다.
  const definedSources = useMemo<QuoteSource[]>(() => {
    const out: QuoteSource[] = [];
    for (const q of questions) {
      // 질문 레벨 — 수집기와 동일하게 표 질문은 제외한다(answer-quote.ts:213 `q.type !==
      // 'table'`). 표는 셀이 각자 이름을 갖고, 질문 레벨 토글은 수집기가 아예 보지 않는다 —
      // 여기서도 정의로 치면 실제로는 항상 빈 문자열인 참조를 "정의됨"으로 오판한다.
      if (q.type !== 'table' && q.answerQuoteEnabled) {
        const name = (q.answerQuoteName ?? '').trim();
        if (name) {
          out.push({
            name,
            order: q.order,
            label: q.title || '(제목 없음)',
            questionId: q.id,
            scope: 'question',
            hasText: hasAnyQuoteText(q),
          });
        }
      }

      // 셀 레벨 — 질문 노릇을 하는 셀(QUESTION_LIKE_CELL_TYPES)마다 자기 이름으로 정의를
      // 추가한다. choice_opt/ranking_opt 는 옵션이라 제외(질문 레벨 경로가 이미 담당).
      for (const row of q.tableRowsData ?? []) {
        for (const cell of row.cells) {
          if (cell.isHidden) continue;
          if (!QUESTION_LIKE_CELL_TYPES.has(cell.type)) continue;
          if (!cell.answerQuoteEnabled) continue;
          const cellName = (cell.answerQuoteName ?? '').trim();
          if (!cellName) continue;
          out.push({
            name: cellName,
            order: q.order, // 셀은 자기 order 가 없다 — 호스트 질문 order 를 그대로 쓴다
            label: `${q.title || '(제목 없음)'} · ${formatCellLabel(cell)}`,
            questionId: q.id,
            scope: 'cell',
            hasText: cellHasQuoteText(cell),
          });
        }
      }
    }
    return out;
  }, [questions]);
  const definedNames = useMemo(
    () => new Set(definedSources.map((s) => s.name)),
    [definedSources],
  );

  // 소비처 참조 — 질문 본문 + 그룹 이름.
  const references = useMemo<QuoteReference[]>(() => {
    const out: QuoteReference[] = [];
    for (const q of questions) {
      for (const name of extractQuoteTokens(...substitutedSourcesOf(q))) {
        out.push({ name, order: q.order, label: q.title || '(제목 없음)', questionId: q.id });
      }
    }
    for (const g of groups) {
      const names = extractQuoteTokens(g.name);
      if (names.length === 0) continue;
      const ownerOrders = collectDescendantQuestionOrders(g.id, questions, groups);
      const ownerOrder = ownerOrders.length > 0 ? Math.min(...ownerOrders) : null;
      for (const name of names) {
        out.push({ name, order: ownerOrder, label: `그룹 "${g.name}"`, questionId: null });
      }
    }
    return out;
  }, [questions, groups]);

  // 경고 1: 정의되지 않은 인용 이름 참조
  const undefinedNames = useMemo(() => {
    const set = new Set<string>();
    for (const ref of references) {
      if (!definedNames.has(ref.name)) set.add(ref.name);
    }
    return Array.from(set);
  }, [references, definedNames]);

  // 경고 2: 인용을 켰는데 문구가 전부 빈 질문/셀
  const emptyQuoteQuestions = useMemo(() => {
    return definedSources.filter((src) => !src.hasText);
  }, [definedSources]);

  // 경고 3: 뒤를 참조하는 경우 (소비처 order < 출처 order, 자기참조 포함해 <=).
  // 셀 출처는 호스트 질문의 order 를 쓰므로, 같은 표 안의 참조·정의는 항상 order 가 같다 —
  // 표는 한 화면에 다 나오고 응답 순서가 정해져 있지 않으므로 이 조합은 판정하지 않는다.
  const backwardReferences = useMemo(() => {
    const out: { consumerLabel: string; sourceLabel: string; name: string }[] = [];
    for (const ref of references) {
      if (ref.order === null) continue;
      for (const src of definedSources) {
        if (src.name !== ref.name) continue;
        if (src.scope === 'cell' && ref.questionId === src.questionId) continue;
        if (ref.order <= src.order) {
          out.push({ consumerLabel: ref.label, sourceLabel: src.label, name: ref.name });
        }
      }
    }
    return out;
  }, [references, definedSources]);

  // 경고 4: 치환되지 않는 자리(완료 메시지 / prefill 템플릿 / 표 제목 · 열 제목 · 헤더 그리드 /
  // 검증 오류 메시지)에 쓴 인용 토큰
  const nonSubstitutedFindings = useMemo(() => {
    const out: { location: string; name: string }[] = [];
    for (const name of extractQuoteTokens(thankYouMessage)) {
      out.push({ location: '완료 메시지', name });
    }
    for (const q of questions) {
      const label = q.title || '(제목 없음)';
      // prefill 템플릿은 질문 레벨(question-input.tsx)·표 셀(cells/input-cell.tsx) 모두
      // attrs 만 치환한다. prefill 결과는 응답으로 저장되는 값이고 응답 인용은 저장되지
      // 않는 파생값이라, 두 채널을 섞지 않는다(서버 재검증도 attrs 기준 — response.service.ts).
      for (const name of extractQuoteTokens(q.defaultValueTemplate ?? undefined)) {
        out.push({ location: `단답형 prefill 템플릿 (${label})`, name });
      }
      for (const name of extractQuoteTokens(q.tableTitle)) {
        out.push({ location: `표 제목 (${label})`, name });
      }
      // 열 제목 - tableHeaderGrid 가 없으면 헤더는 tableColumns[].label 로 렌더된다
      // (table-preview.tsx / interactive-table-response.tsx). 둘 다 치환하지 않는다.
      for (const column of q.tableColumns ?? []) {
        for (const name of extractQuoteTokens(column.label)) {
          out.push({ location: `표 열 제목 (${label})`, name });
        }
      }
      for (const headerRow of q.tableHeaderGrid ?? []) {
        for (const cell of headerRow) {
          for (const name of extractQuoteTokens(cell.label)) {
            out.push({ location: `표 헤더 그리드 (${label})`, name });
          }
        }
      }
      for (const constraint of q.sumConstraints ?? []) {
        for (const name of extractQuoteTokens(constraint.errorMessage)) {
          out.push({ location: `검증 오류 메시지 (${label})`, name });
        }
      }
      for (const row of q.tableRowsData ?? []) {
        for (const cell of row.cells) {
          for (const name of extractQuoteTokens(cell.defaultValueTemplate)) {
            out.push({ location: `표 셀 prefill 템플릿 (${label})`, name });
          }
        }
      }
    }
    return out;
  }, [questions, thankYouMessage]);

  const hasAnything =
    unknownContactKeys.length > 0 ||
    undefinedNames.length > 0 ||
    emptyQuoteQuestions.length > 0 ||
    backwardReferences.length > 0 ||
    nonSubstitutedFindings.length > 0;

  if (!hasAnything) return null;

  return (
    <div className="space-y-2">
      {unknownContactKeys.length > 0 && (
        <WarningBox tone="amber" title={`컨택 컬럼에 없는 토큰 ${unknownContactKeys.length}개`}>
          <div className="mt-1 font-mono text-xs">
            {unknownContactKeys.map((k) => `{{${k}}}`).join(', ')}
          </div>
          <div className="mt-1 text-xs">발송 시 빈 값으로 치환됩니다.</div>
        </WarningBox>
      )}

      {backwardReferences.length > 0 && (
        <WarningBox
          tone="red"
          title={`뒤 질문의 응답을 인용하는 설정 오류 ${backwardReferences.length}건`}
        >
          <div className="mt-1 space-y-0.5 text-xs">
            {backwardReferences.map((b, i) => (
              <div key={i}>
                {`"${b.consumerLabel}" 이(가) "${b.sourceLabel}"(인용 이름: ${b.name})의 응답을 인용하지만, 출처 질문이 더 뒤에 있어 응답자에게는 항상 빈 문장으로 보입니다.`}
              </div>
            ))}
          </div>
          <div className="mt-1 text-xs font-medium">
            질문 순서를 바꾸거나 인용 참조를 제거하세요.
          </div>
        </WarningBox>
      )}

      {undefinedNames.length > 0 && (
        <WarningBox tone="amber" title={`정의되지 않은 인용 이름 ${undefinedNames.length}개`}>
          <div className="mt-1 font-mono text-xs">
            {undefinedNames.map((n) => `{{{${n}}}}`).join(', ')}
          </div>
          <div className="mt-1 text-xs">
            이 이름으로 응답 인용을 켠 질문이 없습니다. 질문이 삭제되었거나 인용 이름이
            바뀌었을 수 있습니다. 항상 빈 문자열로 치환됩니다.
          </div>
        </WarningBox>
      )}

      {emptyQuoteQuestions.length > 0 && (
        <WarningBox
          tone="amber"
          title={`인용 문구가 모두 비어 있는 질문 ${emptyQuoteQuestions.length}개`}
        >
          <div className="mt-1 space-y-0.5 text-xs">
            {emptyQuoteQuestions.map((s, i) => (
              <div key={i}>{`"${s.label}" (인용 이름: ${s.name})`}</div>
            ))}
          </div>
          <div className="mt-1 text-xs">
            응답 인용은 켜져 있지만 어떤 옵션·입력에도 문구가 없어 항상 빈 문자열로
            치환됩니다.
          </div>
        </WarningBox>
      )}

      {nonSubstitutedFindings.length > 0 && (
        <WarningBox
          tone="amber"
          title={`치환되지 않는 자리에 쓴 인용 토큰 ${nonSubstitutedFindings.length}개`}
        >
          <div className="mt-1 space-y-0.5 text-xs">
            {nonSubstitutedFindings.map((f, i) => (
              <div key={i} className="font-mono">{`{{{${f.name}}}} — ${f.location}`}</div>
            ))}
          </div>
          <div className="mt-1 text-xs">
            완료 메시지·prefill 템플릿(단답형·표 셀)·표 제목·표 열 제목·표 헤더 그리드·검증
            오류 메시지는 응답 인용이 적용되지 않는 자리입니다. 토큰이 그대로 노출됩니다.
          </div>
        </WarningBox>
      )}
    </div>
  );
}
