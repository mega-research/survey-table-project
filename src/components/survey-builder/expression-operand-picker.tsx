'use client';

import { Plus, X } from 'lucide-react';

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

export const MAX_OPERAND_DEPTH = 2;

// selector 안에서 ?? [] 하면 매 렌더마다 새 배열 → useSyncExternalStore 무한 루프 경고.
// 모듈 스코프 안정 참조 fallback.
const EMPTY_LOOKUPS: SurveyLookup[] = [];
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
  const questions = useSurveyBuilderStore((s) => s.currentSurvey.questions);
  const contactColumns =
    useSurveyBuilderStore((s) => s.currentSurvey.contactColumns?.columns) ??
    EMPTY_CONTACT_COLUMNS;
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.lookups) ?? EMPTY_LOOKUPS;

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
          attrColumns={contactColumns.map((c) => c.key)}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'lookup' && (
        <LookupSub
          value={value}
          onChange={onChange}
          lookups={lookups}
          attrColumns={contactColumns.map((c) => c.key)}
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
  const tableQuestions = questions.filter((q) => q.type === 'table');
  const selectedQuestion = tableQuestions.find((q) => q.id === value.questionId);
  const inputCells = (selectedQuestion?.tableRowsData ?? []).flatMap((row) =>
    (row.cells ?? [])
      .filter((c) => c.type === 'input')
      .map((c) => ({
        cellId: c.id,
        label: `${row.label?.trim() || row.id.slice(0, 6)} / ${c.exportLabel ?? c.cellCode ?? c.id.slice(0, 6)}`,
      })),
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
  const eligible = questions.filter((q) =>
    ['radio', 'select', 'text', 'textarea', 'checkbox'].includes(q.type),
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
  attrColumns,
  idPrefix,
}: {
  value: ExpressionOperand & { kind: 'lookup' };
  onChange: (next: ExpressionOperand) => void;
  lookups: SurveyLookup[];
  attrColumns: string[];
  idPrefix: string;
}) {
  const selectedLut = lookups.find((l) => l.id === value.surveyLookupId);
  const lutColumns = selectedLut?.columns ?? [];

  const setLut = (lutId: string) =>
    onChange({ kind: 'lookup', surveyLookupId: lutId, keyMapping: [], valueColumn: '' });

  const setValueColumn = (col: string) => onChange({ ...value, valueColumn: col });

  const addMapping = () =>
    onChange({ ...value, keyMapping: [...value.keyMapping, { lutKey: '', attrsKey: '' }] });

  const updateMapping = (
    idx: number,
    patch: Partial<{ lutKey: string; attrsKey: string }>,
  ) => {
    const next = [...value.keyMapping];
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...value, keyMapping: next });
  };

  const removeMapping = (idx: number) =>
    onChange({ ...value, keyMapping: value.keyMapping.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-2">
      <Select value={value.surveyLookupId} onValueChange={setLut}>
        <SelectTrigger id={`${idPrefix}-lut`}>
          <SelectValue placeholder="외부 데이터 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {lookups.length === 0 && (
            <div className="p-2 text-xs text-slate-500">등록된 외부 데이터가 없습니다</div>
          )}
          {lookups.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedLut && (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">값 컬럼</Label>
            <Select value={value.valueColumn} onValueChange={setValueColumn}>
              <SelectTrigger id={`${idPrefix}-vcol`}>
                <SelectValue placeholder="컬럼 선택" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {lutColumns.length === 0 && (
                  <div className="p-2 text-xs text-slate-500">LUT 에 컬럼이 없습니다</div>
                )}
                {lutColumns.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">키 매핑 (LUT 컬럼 = 컨택 속성)</Label>
            {value.keyMapping.map((m, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <Select
                  value={m.lutKey}
                  onValueChange={(k) => updateMapping(idx, { lutKey: k })}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="LUT 컬럼" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {lutColumns.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-slate-500">=</span>
                <Select
                  value={m.attrsKey}
                  onValueChange={(k) => updateMapping(idx, { attrsKey: k })}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="컨택 속성" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {attrColumns.length === 0 && (
                      <div className="p-2 text-xs text-slate-500">컨택 컬럼이 없습니다</div>
                    )}
                    {attrColumns.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMapping(idx)}
                  aria-label="매핑 삭제"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addMapping}>
              <Plus className="mr-1 h-3 w-3" /> 매핑 추가
            </Button>
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
          <SelectItem value="*">x</SelectItem>
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
