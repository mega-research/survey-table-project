'use client';

import { useMemo } from 'react';

import { Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { ExpressionOperand, Question, SurveyLookup } from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';

import { LookupKeyMappingEditor } from './lookup-key-mapping-editor';
import { LookupSelector } from './lookup-selector';
import { EMPTY_LOOKUPS } from './lookup-shared';

export const MAX_OPERAND_DEPTH = 2;

// useShallow selector 결과가 undefined 일 때 모듈 스코프 안정 참조로 fallback.
// (lookups 는 lookup-shared 의 EMPTY_LOOKUPS 사용)
const EMPTY_CONTACT_COLUMNS: { key: string }[] = [];

interface OperandPickerProps {
  value: ExpressionOperand | undefined;
  onChange: (next: ExpressionOperand) => void;
  currentDepth: number; // root = 0
  idPrefix: string;
}

const KIND_LABELS: Record<ExpressionOperand['kind'], string> = {
  literal: '직접 입력',
  cell: '테이블 셀',
  question: '질문 응답',
  attr: '컨택 메타데이터',
  lookup: '외부 데이터 (LUT)',
  binop: '계산 (산술)',
};

export function ExpressionOperandPicker({
  value,
  onChange,
  currentDepth,
  idPrefix,
}: OperandPickerProps) {
  // useShallow 로 3 selector 통합 — currentSurvey 의 다른 필드 변경 시 picker 가 re-render 되지 않게.
  const { questions, contactColumnsRaw, lookupsRaw } = useSurveyBuilderStore(
    useShallow((s) => ({
      questions: s.currentSurvey.questions,
      contactColumnsRaw: s.currentSurvey.contactColumns?.columns,
      lookupsRaw: s.currentSurvey.lookups,
    })),
  );
  const contactColumns = contactColumnsRaw ?? EMPTY_CONTACT_COLUMNS;
  const lookups = lookupsRaw ?? EMPTY_LOOKUPS;
  // attr operand picker 와 LookupKeyMappingEditor 가 같은 attrs 키 리스트를 쓰므로 1회만 파생.
  const attrKeys = useMemo(() => contactColumns.map((c) => c.key), [contactColumns]);

  const canNestBinop = currentDepth < MAX_OPERAND_DEPTH;

  const setKind = (kind: ExpressionOperand['kind']) => {
    switch (kind) {
      case 'literal':
        onChange({ kind: 'literal', value: 0 });
        break;
      case 'cell':
        onChange({ kind: 'cell', questionId: '', cellId: '' });
        break;
      case 'question':
        onChange({ kind: 'question', questionId: '' });
        break;
      case 'attr':
        onChange({ kind: 'attr', attrsKey: '' });
        break;
      case 'lookup':
        onChange({ kind: 'lookup', surveyLookupId: '', keyMapping: [], valueColumn: '' });
        break;
      case 'binop':
        onChange({
          kind: 'binop',
          op: '+',
          left: { kind: 'literal', value: 0 },
          right: { kind: 'literal', value: 0 },
        });
        break;
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <Select
        value={value?.kind ?? ''}
        onValueChange={(v) => setKind(v as ExpressionOperand['kind'])}
      >
        <SelectTrigger id={`${idPrefix}-kind`} className="w-full">
          <SelectValue placeholder="operand 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {(Object.keys(KIND_LABELS) as Array<ExpressionOperand['kind']>)
            // depth 0 의 산술은 ComparisonClauseEditor 의 inline 셀렉트가 담당. 2-deep 케이스는 depth >= 1 에서만 노출.
            .filter((k) => k !== 'binop' || (canNestBinop && currentDepth >= 1))
            .map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k]}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      {value?.kind === 'literal' && (
        <Input
          id={`${idPrefix}-literal`}
          value={String(value.value)}
          onChange={(e) => {
            const raw = e.target.value;
            const n = parseFloat(raw);
            onChange({ kind: 'literal', value: Number.isFinite(n) ? n : raw });
          }}
          placeholder="숫자 또는 텍스트"
        />
      )}

      {value?.kind === 'cell' && (
        <CellPickerSub
          value={value}
          onChange={onChange}
          questions={questions}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'question' && (
        <QuestionPickerSub
          value={value}
          onChange={onChange}
          questions={questions}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'attr' && (
        <AttrPickerSub
          value={value}
          onChange={onChange}
          attrColumns={attrKeys}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'lookup' && (
        <LookupSub
          value={value}
          onChange={onChange}
          lookups={lookups}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'binop' && (
        <BinopSub
          value={value}
          onChange={onChange}
          currentDepth={currentDepth + 1}
          idPrefix={idPrefix}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-editors
// ---------------------------------------------------------------------------

function CellPickerSub({
  value,
  onChange,
  questions,
  idPrefix,
}: {
  value: ExpressionOperand & { kind: 'cell' };
  onChange: (next: ExpressionOperand) => void;
  questions: Question[];
  idPrefix: string;
}) {
  const tableQuestions = useMemo(
    () => questions.filter((q) => q.type === 'table'),
    [questions],
  );
  const selectedQuestion = tableQuestions.find((q) => q.id === value.questionId);
  const inputCells = useMemo(
    () =>
      (selectedQuestion?.tableRowsData ?? []).flatMap((row) =>
        (row.cells ?? [])
          // 가로/세로 병합으로 가려진 후속 셀 제외 — 머지 영역의 첫 셀만 노출
          .filter((c) => c.type === 'input' && !c.isHidden)
          .map((c) => ({
            cellId: c.id,
            label: formatCellLabel(c),
          })),
      ),
    [selectedQuestion],
  );

  return (
    <div className="space-y-2">
      <Select
        value={value.questionId}
        onValueChange={(qId) => onChange({ kind: 'cell', questionId: qId, cellId: '' })}
      >
        <SelectTrigger id={`${idPrefix}-q`}>
          <SelectValue placeholder="질문 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {tableQuestions.length === 0 && (
            <div className="p-2 text-xs text-slate-500">테이블 질문이 없습니다</div>
          )}
          {tableQuestions.map((q) => (
            <SelectItem key={q.id} value={q.id}>
              {q.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.questionId && (
        <Select
          value={value.cellId}
          onValueChange={(cId) => onChange({ ...value, cellId: cId })}
        >
          <SelectTrigger id={`${idPrefix}-c`}>
            <SelectValue placeholder="셀 선택" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {inputCells.length === 0 && (
              <div className="p-2 text-xs text-slate-500">이 질문에 input 셀이 없습니다</div>
            )}
            {inputCells.map((c) => (
              <SelectItem key={c.cellId} value={c.cellId}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function QuestionPickerSub({
  value,
  onChange,
  questions,
  idPrefix,
}: {
  value: ExpressionOperand & { kind: 'question' };
  onChange: (next: ExpressionOperand) => void;
  questions: Question[];
  idPrefix: string;
}) {
  const eligible = useMemo(
    () =>
      questions.filter((q) =>
        ['radio', 'select', 'text', 'textarea', 'checkbox'].includes(q.type),
      ),
    [questions],
  );
  return (
    <Select
      value={value.questionId}
      onValueChange={(qId) => onChange({ kind: 'question', questionId: qId })}
    >
      <SelectTrigger id={`${idPrefix}-q`}>
        <SelectValue placeholder="질문 선택" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {eligible.length === 0 && (
          <div className="p-2 text-xs text-slate-500">사용 가능한 질문이 없습니다</div>
        )}
        {eligible.map((q) => (
          <SelectItem key={q.id} value={q.id}>
            {q.title} ({q.type})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AttrPickerSub({
  value,
  onChange,
  attrColumns,
  idPrefix,
}: {
  value: ExpressionOperand & { kind: 'attr' };
  onChange: (next: ExpressionOperand) => void;
  attrColumns: string[];
  idPrefix: string;
}) {
  return (
    <Select
      value={value.attrsKey}
      onValueChange={(k) => onChange({ kind: 'attr', attrsKey: k })}
    >
      <SelectTrigger id={`${idPrefix}-attr`}>
        <SelectValue placeholder="컨택 속성 선택" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {attrColumns.length === 0 && (
          <div className="p-2 text-xs text-slate-500">설문에 컨택 컬럼이 정의되지 않았습니다</div>
        )}
        {attrColumns.map((k) => (
          <SelectItem key={k} value={k}>
            {k}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LookupSub({
  value,
  onChange,
  lookups,
  idPrefix,
}: {
  value: ExpressionOperand & { kind: 'lookup' };
  onChange: (next: ExpressionOperand) => void;
  lookups: SurveyLookup[];
  idPrefix: string;
}) {
  const selectedLut = lookups.find((l) => l.id === value.surveyLookupId);
  const usedAsKey = new Set(value.keyMapping.map((m) => m.lutKey).filter(Boolean));
  const valueCandidates = (selectedLut?.columns ?? []).filter((c) => !usedAsKey.has(c));

  return (
    <div className="space-y-2">
      <LookupSelector
        value={value.surveyLookupId}
        onChange={(id) =>
          onChange({ kind: 'lookup', surveyLookupId: id, keyMapping: [], valueColumn: '' })
        }
      />

      {selectedLut && (
        <>
          <LookupKeyMappingEditor
            availableLutColumns={selectedLut.columns}
            value={value.keyMapping}
            onChange={(km) => {
              // value 컬럼이 새로운 key 매핑에 포함되면 비움 (의미상 같은 컬럼을 키와 값으로 쓰면 안 됨)
              const used = new Set(km.map((m) => m.lutKey).filter(Boolean));
              const nextValueColumn = used.has(value.valueColumn) ? '' : value.valueColumn;
              onChange({ ...value, keyMapping: km, valueColumn: nextValueColumn });
            }}
          />

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">값 컬럼</Label>
            <Select
              value={value.valueColumn}
              onValueChange={(col) => onChange({ ...value, valueColumn: col })}
            >
              <SelectTrigger id={`${idPrefix}-vcol`}>
                <SelectValue placeholder="컬럼 선택" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {valueCandidates.length === 0 && (
                  <div className="p-2 text-xs text-slate-500">
                    값으로 쓸 컬럼이 없습니다 (키로 사용된 컬럼은 제외)
                  </div>
                )}
                {valueCandidates.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}

function BinopSub({
  value,
  onChange,
  currentDepth,
  idPrefix,
}: {
  value: ExpressionOperand & { kind: 'binop' };
  onChange: (next: ExpressionOperand) => void;
  currentDepth: number;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2 border-l-2 border-blue-200 pl-3">
      <ExpressionOperandPicker
        value={value.left}
        onChange={(left) => onChange({ ...value, left })}
        currentDepth={currentDepth}
        idPrefix={`${idPrefix}-l`}
      />
      <Select
        value={value.op}
        onValueChange={(op) => onChange({ ...value, op: op as '+' | '-' | '*' | '/' })}
      >
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          <SelectItem value="+">+</SelectItem>
          <SelectItem value="-">-</SelectItem>
          <SelectItem value="*">×</SelectItem>
          <SelectItem value="/">÷</SelectItem>
        </SelectContent>
      </Select>
      <ExpressionOperandPicker
        value={value.right}
        onChange={(right) => onChange({ ...value, right })}
        currentDepth={currentDepth}
        idPrefix={`${idPrefix}-r`}
      />
    </div>
  );
}
