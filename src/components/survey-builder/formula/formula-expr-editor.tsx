'use client';

import { useMemo } from 'react';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { CalcExpr, Question } from '@/types/survey';

import { EMPTY_LOOKUPS } from '../lookup-shared';
import { type CalcOperator, formatFormulaPreview } from './format-formula';
import {
  AggEditor,
  CellRefPicker,
  LiteralInput,
  LookupTermEditor,
  QuestionRefPicker,
} from './formula-term-pickers';

/**
 * 셀 수식 빌더 — 중첩 가능한 구조화 에디터.
 *
 * 모델은 "그룹 = 연산자 1개 + 항 N개"다. 연산자를 섞으려면 그룹을 중첩한다:
 * `(n × m) + (x × y)` = group(+, [group(*, [n, m]), group(*, [x, y])]).
 * 덕분에 연산자 우선순위 모호성이 구조적으로 생길 수 없다 — 괄호는 트리 그 자체다.
 *
 * 진단(깨진 참조/순환/비숫자 참조)은 여기서 판정하지 않는다 — cell-formula-diagnostics.ts 가
 * 단일 통로이고 경고 표시는 빌더 경고 패널이 담당한다. 이 화면은 조립과 미리보기만 한다.
 */

type GroupExpr = Extract<CalcExpr, { kind: 'group' }>;

/** 저장 값은 ASCII, 표시는 기호. 전각 ＋ 는 − × ÷ 와 폭을 맞추기 위한 것이다. */
const OPERATOR_OPTIONS: Array<{ value: CalcOperator; label: string }> = [
  { value: '+', label: '＋' },
  { value: '-', label: '−' },
  { value: '*', label: '×' },
  { value: '/', label: '÷' },
];

const TERM_KIND_LABELS: Record<CalcExpr['kind'], string> = {
  cell: '셀 참조',
  question: '질문 응답',
  literal: '상수',
  lookup: '외부 데이터 (LUT)',
  agg: 'SUM · AVG',
  group: '하위 그룹',
};

/** "항 추가" 메뉴 순서 — 자주 쓰는 것부터. */
const ADD_TERM_KINDS: Array<CalcExpr['kind']> = [
  'cell',
  'question',
  'literal',
  'lookup',
  'agg',
  'group',
];

const EMPTY_ROOT: GroupExpr = { kind: 'group', op: '+', terms: [] };

function makeTerm(kind: CalcExpr['kind']): CalcExpr {
  switch (kind) {
    case 'cell':
      return { kind: 'cell', cellId: '' }; // questionId 생략 = 같은 질문
    case 'question':
      return { kind: 'question', questionId: '' };
    case 'literal':
      return { kind: 'literal', value: 0 };
    case 'lookup':
      return { kind: 'lookup', surveyLookupId: '', keyMapping: [], valueColumn: '' };
    case 'agg':
      return { kind: 'agg', fn: 'sum', items: [] };
    case 'group':
      return { kind: 'group', op: '+', terms: [] };
  }
}

/** 루트는 항상 그룹이다. 과거 데이터나 손편집으로 단일 항이 들어와도 그룹으로 감싸 편집한다. */
function normalizeRoot(value: CalcExpr | undefined): GroupExpr {
  if (!value) return EMPTY_ROOT;
  if (value.kind === 'group') return value;
  return { kind: 'group', op: '+', terms: [value] };
}

interface FormulaExprEditorProps {
  value: CalcExpr | undefined;
  onChange: (expr: CalcExpr) => void;
  /** 수식을 소유한 질문 — 같은 질문 셀 픽커와 집계 표 미리보기에 쓴다. */
  ownQuestion: Question;
  /** 교차 질문 참조 후보. ownQuestion 이 포함되어 있어도 무방하다. */
  allQuestions: Question[];
}

export function FormulaExprEditor({
  value,
  onChange,
  ownQuestion,
  allQuestions,
}: FormulaExprEditorProps) {
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.lookups) ?? EMPTY_LOOKUPS;

  // 미리보기·픽커가 자기 질문의 최신 셀을 항상 보도록 ownQuestion 을 앞세워 합친다.
  const questions = useMemo(
    () => [ownQuestion, ...allQuestions.filter((q) => q.id !== ownQuestion.id)],
    [ownQuestion, allQuestions],
  );

  const root = normalizeRoot(value);
  const preview = formatFormulaPreview(root, questions, {
    ownQuestionId: ownQuestion.id,
    lookups,
  });

  return (
    <div className="space-y-2">
      <GroupBlock
        value={root}
        onChange={onChange}
        depth={0}
        ownQuestion={ownQuestion}
        allQuestions={allQuestions}
      />
      <div className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
        <span className="font-medium text-gray-500">미리보기</span>{' '}
        <span className="font-mono">{preview}</span>
      </div>
    </div>
  );
}

interface GroupBlockProps {
  value: GroupExpr;
  onChange: (next: GroupExpr) => void;
  depth: number;
  ownQuestion: Question;
  allQuestions: Question[];
}

/** 하위 그룹의 삭제·이동은 그룹 자신이 아니라 그 그룹을 항으로 가진 부모의 TermControls 가 담당한다. */
function GroupBlock({ value, onChange, depth, ownQuestion, allQuestions }: GroupBlockProps) {
  const setTermAt = (index: number, next: CalcExpr) =>
    onChange({ ...value, terms: value.terms.map((t, i) => (i === index ? next : t)) });

  const removeTermAt = (index: number) =>
    onChange({ ...value, terms: value.terms.filter((_, i) => i !== index) });

  // − 와 ÷ 는 항의 순서가 결과를 바꾼다. 순서를 고치려고 뒤 항을 전부 지웠다 다시 넣게 하지 않는다.
  const moveTerm = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.terms.length) return;
    const terms = [...value.terms];
    const [moved] = terms.splice(index, 1);
    if (!moved) return;
    terms.splice(target, 0, moved);
    onChange({ ...value, terms });
  };

  const addTerm = (kind: CalcExpr['kind']) =>
    onChange({ ...value, terms: [...value.terms, makeTerm(kind)] });

  return (
    <div
      className={
        depth === 0
          ? 'space-y-2 rounded border bg-gray-50/50 p-3'
          : 'space-y-2 border-l-2 border-blue-200 bg-white/60 py-1 pl-3'
      }
    >
      <div className="flex items-center gap-2">
        <Select
          value={value.op}
          onValueChange={(op) => onChange({ ...value, op: op as CalcOperator })}
        >
          <SelectTrigger className="h-8 w-20 text-sm" aria-label="그룹 연산자">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATOR_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-gray-500">
          {depth === 0
            ? '모든 항을 이 연산자로 순서대로 계산합니다'
            : '이 그룹을 먼저 계산한 뒤 바깥 그룹의 항으로 씁니다'}
        </span>
      </div>

      {value.terms.length === 0 && (
        <p className="text-xs font-medium text-amber-600">
          항이 없는 그룹입니다 — 항을 추가하거나 그룹을 삭제하세요
        </p>
      )}

      <div className="space-y-1.5">
        {value.terms.map((term, index) => (
          // 항에는 안정 id 가 없어 인덱스를 키로 쓴다. 상수 입력이 값 변화를 스스로 재동기화하므로
          // (LiteralInput) 삭제·이동으로 인덱스가 밀려도 표시가 어긋나지 않는다.
          <div key={index} className="flex items-start gap-2">
            <span className="mt-1.5 w-20 shrink-0 text-xs text-gray-500">
              {TERM_KIND_LABELS[term.kind]}
            </span>
            {term.kind === 'group' ? (
              <div className="flex-1">
                <GroupBlock
                  value={term}
                  onChange={(next) => setTermAt(index, next)}
                  depth={depth + 1}
                  ownQuestion={ownQuestion}
                  allQuestions={allQuestions}
                />
              </div>
            ) : (
              <TermEditor
                term={term}
                onChange={(next) => setTermAt(index, next)}
                ownQuestion={ownQuestion}
                allQuestions={allQuestions}
              />
            )}
            <TermControls
              index={index}
              count={value.terms.length}
              onMove={moveTerm}
              onRemove={removeTermAt}
            />
          </div>
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8">
            <Plus className="mr-1 h-3.5 w-3.5" />항 추가
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ADD_TERM_KINDS.map((kind) => (
            <DropdownMenuItem key={kind} onSelect={() => addTerm(kind)}>
              {TERM_KIND_LABELS[kind]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface TermControlsProps {
  index: number;
  count: number;
  onMove: (index: number, delta: number) => void;
  onRemove: (index: number) => void;
}

function TermControls({ index, count, onMove, onRemove }: TermControlsProps) {
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-1 text-gray-400 hover:text-gray-700"
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
        aria-label="항 위로"
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-1 text-gray-400 hover:text-gray-700"
        disabled={index === count - 1}
        onClick={() => onMove(index, 1)}
        aria-label="항 아래로"
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-1 text-gray-400 hover:text-red-600"
        onClick={() => onRemove(index)}
        aria-label="항 삭제"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface TermEditorProps {
  /** group 은 GroupBlock 이 직접 재귀 렌더하므로 여기 오지 않는다. */
  term: Exclude<CalcExpr, { kind: 'group' }>;
  onChange: (next: CalcExpr) => void;
  ownQuestion: Question;
  allQuestions: Question[];
}

function TermEditor({ term, onChange, ownQuestion, allQuestions }: TermEditorProps) {
  switch (term.kind) {
    case 'cell':
      return (
        <CellRefPicker
          value={term}
          onChange={onChange}
          ownQuestion={ownQuestion}
          allQuestions={allQuestions}
        />
      );
    case 'question':
      return <QuestionRefPicker value={term} onChange={onChange} allQuestions={allQuestions} />;
    case 'literal':
      return <LiteralInput value={term} onChange={onChange} />;
    case 'lookup':
      return <LookupTermEditor value={term} onChange={onChange} />;
    case 'agg':
      return (
        <AggEditor
          value={term}
          onChange={onChange}
          ownQuestion={ownQuestion}
          allQuestions={allQuestions}
        />
      );
  }
}
