'use client';

import { useMemo, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { CalcExpr, Question, TableCell } from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

import { LookupKeyMappingEditor } from '@/features/survey-builder/lookup/lookup-key-mapping-editor';
import { LookupSelector } from '@/features/survey-builder/lookup/lookup-selector';
import { EMPTY_LOOKUPS, NONE_SENTINEL } from '@/features/survey-builder/lookup/lookup-shared';
import { TablePreview } from '@/features/question-renderer/table-preview';

/**
 * 수식 빌더의 "항" 종류별 편집 UI 모음.
 *
 * 각 컴포넌트는 `value`/`onChange` 만 주고받는 제어 컴포넌트다 — 트리 구조 조작(추가/삭제/중첩)은
 * 전부 formula-expr-editor.tsx 의 그룹 블록이 담당한다.
 */

export type CellExpr = Extract<CalcExpr, { kind: 'cell' }>;
export type QuestionExpr = Extract<CalcExpr, { kind: 'question' }>;
export type LiteralExpr = Extract<CalcExpr, { kind: 'literal' }>;
export type LookupExpr = Extract<CalcExpr, { kind: 'lookup' }>;
export type AggExpr = Extract<CalcExpr, { kind: 'agg' }>;
export type AttrExpr = Extract<CalcExpr, { kind: 'attr' }>;

/** 수식이 값으로 참조할 수 있는 셀 — 숫자 input 셀과 계산 셀. 병합으로 가려진 셀은 값을 가질 수 없다. */
export function isReferenceableCell(cell: TableCell): boolean {
  return (
    !cell.isHidden && ((cell.type === 'input' && cell.inputType === 'number') || cell.type === 'calc')
  );
}

/** 집계(SUM/AVG) 대상은 숫자 input 셀만. 계산 셀 중첩은 개별 cell 항으로 표현한다. */
function isAggregatableCell(cell: TableCell): boolean {
  return !cell.isHidden && cell.type === 'input' && cell.inputType === 'number';
}

function questionLabel(question: Question): string {
  return question.questionCode || question.title || question.id.slice(0, 6);
}

/** 같은 질문 참조는 questionId 를 생략해 저장한다 (exactOptionalPropertyTypes — 키 자체를 넣지 않는다). */
function makeCellExpr(questionId: string, cellId: string, ownQuestionId: string): CellExpr {
  return questionId === ownQuestionId ? { kind: 'cell', cellId } : { kind: 'cell', questionId, cellId };
}

// ---------------------------------------------------------------------------
// 셀 참조
// ---------------------------------------------------------------------------

interface CellRefPickerProps {
  value: CellExpr;
  onChange: (next: CellExpr) => void;
  /** 수식을 소유한 질문. 여기 셀을 고르면 questionId 를 생략해 저장한다. */
  ownQuestion: Question;
  allQuestions: Question[];
  /**
   * 고를 수 있는 셀의 조건. 기본은 수식이 값으로 참조할 수 있는 모든 셀(`isReferenceableCell`).
   * 집계(SUM/AVG) 항처럼 더 좁은 제약이 있는 자리는 자기 필터를 넘겨야 한다 — 표 오버레이만
   * 막고 이 픽커를 열어두면 제약이 그대로 우회된다.
   */
  cellFilter?: (cell: TableCell) => boolean;
}

export function CellRefPicker({
  value,
  onChange,
  ownQuestion,
  allQuestions,
  cellFilter = isReferenceableCell,
}: CellRefPickerProps) {
  // 자기 질문을 항상 첫 항목으로 노출 — allQuestions 에 아직 반영되지 않은 신규 질문도 고를 수 있어야 한다.
  const tableQuestions = useMemo(() => {
    const others = allQuestions.filter((q) => q.type === 'table' && q.id !== ownQuestion.id);
    return [ownQuestion, ...others];
  }, [allQuestions, ownQuestion]);

  const selectedQuestionId = value.questionId ?? ownQuestion.id;
  const selectedQuestion = tableQuestions.find((q) => q.id === selectedQuestionId);

  const cells = useMemo(
    () =>
      (selectedQuestion?.tableRowsData ?? [])
        .flatMap((row) => row.cells)
        .filter(cellFilter)
        .map((c) => ({ cellId: c.id, label: formatCellLabel(c) })),
    [selectedQuestion, cellFilter],
  );

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <Select
        value={selectedQuestionId}
        onValueChange={(qId) => onChange(makeCellExpr(qId, '', ownQuestion.id))}
      >
        <SelectTrigger className="h-8 w-52 text-sm">
          <SelectValue placeholder="질문 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {tableQuestions.map((q) => (
            <SelectItem key={q.id} value={q.id}>
              {q.id === ownQuestion.id ? `이 질문 (${questionLabel(q)})` : questionLabel(q)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.cellId}
        onValueChange={(cId) => onChange(makeCellExpr(selectedQuestionId, cId, ownQuestion.id))}
      >
        <SelectTrigger className="h-8 w-52 text-sm">
          <SelectValue placeholder="셀 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {cells.length === 0 && (
            <div className="p-2 text-xs text-gray-500">참조할 수 있는 숫자 셀이 없습니다</div>
          )}
          {cells.map((c) => (
            <SelectItem key={c.cellId} value={c.cellId}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 질문 참조 (숫자형 단답)
// ---------------------------------------------------------------------------

interface QuestionRefPickerProps {
  value: QuestionExpr;
  onChange: (next: QuestionExpr) => void;
  allQuestions: Question[];
}

export function QuestionRefPicker({ value, onChange, allQuestions }: QuestionRefPickerProps) {
  const eligible = useMemo(
    () => allQuestions.filter((q) => q.type === 'text' && q.inputType === 'number'),
    [allQuestions],
  );

  return (
    <div className="flex-1">
      <Select
        value={value.questionId}
        onValueChange={(qId) => onChange({ kind: 'question', questionId: qId })}
      >
        <SelectTrigger className="h-8 w-full max-w-sm text-sm">
          <SelectValue placeholder="숫자형 단답 질문 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {eligible.length === 0 && (
            <div className="p-2 text-xs text-gray-500">숫자 입력 모드의 단답형 질문이 없습니다</div>
          )}
          {eligible.map((q) => (
            <SelectItem key={q.id} value={q.id}>
              {questionLabel(q)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

interface LiteralInputProps {
  value: LiteralExpr;
  onChange: (next: LiteralExpr) => void;
}

export function LiteralInput({ value, onChange }: LiteralInputProps) {
  // 타이핑 중간 상태('-', '1.')는 number 로 표현할 수 없으므로 raw 문자열을 따로 들고 있는다.
  const [raw, setRaw] = useState(() => String(value.value));
  const [syncedValue, setSyncedValue] = useState(value.value);
  // 외부에서 값이 바뀌면(항 삭제로 인덱스가 밀리는 등) raw 를 재동기화 — 렌더 중 state 조정 패턴.
  if (value.value !== syncedValue) {
    setSyncedValue(value.value);
    setRaw(String(value.value));
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      <Input
        value={raw}
        onChange={(e) => {
          const next = e.target.value;
          if (!isPartialNumericInput(next)) return;
          setRaw(next);
          const parsed = parseNumericInput(next);
          if (parsed === null) return;
          setSyncedValue(parsed);
          onChange({ kind: 'literal', value: parsed });
        }}
        placeholder="숫자"
        className="h-8 w-32 text-sm"
        inputMode="decimal"
      />
      {parseNumericInput(raw) === null && (
        <span className="text-xs text-amber-600">숫자를 입력하세요</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LUT
// ---------------------------------------------------------------------------

interface LookupTermEditorProps {
  value: LookupExpr;
  onChange: (next: LookupExpr) => void;
}

/**
 * LUT 항 편집. 분기 조건 우변의 LookupComparandEditor 와 같은 3단 구성이며
 * (LUT 선택 → 키 매핑 → 값 컬럼), 키로 쓴 컬럼은 값 컬럼 후보에서 제외한다.
 */
export function LookupTermEditor({ value, onChange }: LookupTermEditorProps) {
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.lookups) ?? EMPTY_LOOKUPS;
  const selected = lookups.find((l) => l.id === value.surveyLookupId);

  const usedAsKey = new Set(value.keyMapping.map((m) => m.lutKey).filter(Boolean));
  const valueCandidates = (selected?.columns ?? []).filter((c) => !usedAsKey.has(c));

  return (
    <div className="flex-1 space-y-2 rounded border bg-white p-2">
      <LookupSelector
        value={value.surveyLookupId}
        onChange={(id) =>
          // LUT 가 바뀌면 이전 LUT 의 컬럼 이름이 안 맞으므로 키 매핑과 값 컬럼을 리셋
          onChange({ kind: 'lookup', surveyLookupId: id, keyMapping: [], valueColumn: '' })
        }
      />

      {selected && (
        <>
          <LookupKeyMappingEditor
            availableLutColumns={selected.columns}
            value={value.keyMapping}
            onChange={(km) => {
              const newUsed = new Set(km.map((m) => m.lutKey).filter(Boolean));
              const nextValueColumn = newUsed.has(value.valueColumn) ? '' : value.valueColumn;
              onChange({ ...value, keyMapping: km, valueColumn: nextValueColumn });
            }}
          />

          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600">값 컬럼</div>
            {selected.columns.length === 0 ? (
              <div className="text-xs text-amber-600">
                선택한 LUT 에 컬럼이 없습니다. LUT 편집에서 컬럼을 1개 이상 추가하세요.
              </div>
            ) : valueCandidates.length === 0 ? (
              <div className="text-xs text-amber-600">
                모든 컬럼이 키로 사용 중입니다. 값으로 쓸 컬럼이 남도록 키를 줄이세요.
              </div>
            ) : (
              <Select
                value={value.valueColumn || NONE_SENTINEL}
                onValueChange={(v) =>
                  onChange({ ...value, valueColumn: v === NONE_SENTINEL ? '' : v })
                }
              >
                <SelectTrigger className="h-8 w-64 text-sm">
                  <SelectValue placeholder="값 컬럼 선택" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value={NONE_SENTINEL} disabled>
                    — 미선택 —
                  </SelectItem>
                  {valueCandidates.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 집계 (SUM / AVG)
// ---------------------------------------------------------------------------

interface AggEditorProps {
  value: AggExpr;
  onChange: (next: AggExpr) => void;
  ownQuestion: Question;
  allQuestions: Question[];
}

function isCellItem(item: CalcExpr): item is CellExpr {
  return item.kind === 'cell';
}

/**
 * 같은 셀을 두 번 담으면 SUM 이 조용히 두 배가 된다 — 쓰기 시점에 (질문, 셀) 기준으로 중복 제거.
 * 아직 셀을 고르지 않은 빈 행은 여러 개 있어도 되므로 제외한다.
 */
function dedupeItems(items: CalcExpr[], ownQuestionId: string): CalcExpr[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!isCellItem(item) || !item.cellId) return true;
    const key = `${item.questionId ?? ownQuestionId}:${item.cellId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * SUM/AVG 항 편집.
 *
 * - 같은 질문 셀은 표 위 체크박스로 고른다 (합계 검증 규칙 편집기와 같은 조작감).
 * - 다른 질문 셀은 아래 행으로 추가한다. 그 행에서 "이 질문"을 고르면 questionId 가 생략되며
 *   항이 위쪽 표 체크 상태로 합류한다 (표현이 옮겨갈 뿐 항 자체는 하나로 유지).
 */
export function AggEditor({ value, onChange, ownQuestion, allQuestions }: AggEditorProps) {
  const emit = (items: CalcExpr[]) => onChange({ ...value, items: dedupeItems(items, ownQuestion.id) });

  const aggregatableCellIds = useMemo(
    () =>
      new Set(
        (ownQuestion.tableRowsData ?? [])
          .flatMap((row) => row.cells)
          .filter(isAggregatableCell)
          .map((c) => c.id),
      ),
    [ownQuestion],
  );

  const ownCellIds = new Set(
    value.items
      .filter(isCellItem)
      .filter((item) => (item.questionId ?? ownQuestion.id) === ownQuestion.id)
      .map((item) => item.cellId),
  );

  const toggleOwnCell = (cellId: string) => {
    if (ownCellIds.has(cellId)) {
      emit(
        value.items.filter(
          (item) =>
            !(
              isCellItem(item) &&
              (item.questionId ?? ownQuestion.id) === ownQuestion.id &&
              item.cellId === cellId
            ),
        ),
      );
      return;
    }
    emit([...value.items, { kind: 'cell', cellId }]);
  };

  // 표 체크박스로 다루지 못하는 항(다른 질문 셀 등)만 행으로 노출한다.
  // 셀을 아직 고르지 않은 항(`!item.cellId`)은 반드시 포함해야 한다 — 체크박스는 cellId 로만
  // 항을 잡으므로, 빈 항을 여기서 숨기면 화면 어디에도 나타나지 않는 채 items 에 영구 잔류해
  // 미리보기의 `[삭제된 셀]` 과 broken-ref 진단만 남기고 지울 방법이 사라진다.
  const rowItems = value.items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        !isCellItem(item) ||
        !item.cellId ||
        (item.questionId ?? ownQuestion.id) !== ownQuestion.id,
    );

  const replaceAt = (index: number, next: CalcExpr) =>
    emit(value.items.map((item, i) => (i === index ? next : item)));

  const removeAt = (index: number) => emit(value.items.filter((_, i) => i !== index));

  return (
    <div className="flex-1 space-y-2 rounded border bg-white p-2">
      <div className="flex items-center gap-2">
        <Select
          value={value.fn}
          onValueChange={(fn) => onChange({ ...value, fn: fn as AggExpr['fn'] })}
        >
          <SelectTrigger className="h-8 w-28 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sum">SUM (합계)</SelectItem>
            <SelectItem value="avg">AVG (평균)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-gray-500">
          집계 대상은 숫자 입력 셀입니다. 계산 셀은 개별 셀 참조 항으로 넣으세요.
        </span>
      </div>

      {aggregatableCellIds.size === 0 ? (
        <p className="text-xs font-medium text-amber-600">
          이 질문에 집계할 숫자 입력 셀이 없습니다 — 다른 질문 셀을 추가하세요
        </p>
      ) : (
        value.items.length === 0 && (
          <p className="text-xs font-medium text-amber-600">
            집계할 셀이 선택되지 않았습니다 — 아래 표에서 셀을 선택하세요
          </p>
        )
      )}

      <TablePreview
        columns={ownQuestion.tableColumns}
        rows={ownQuestion.tableRowsData}
        tableHeaderGrid={ownQuestion.tableHeaderGrid ?? undefined}
        hideColumnLabels={ownQuestion.hideColumnLabels}
        renderCell={(cell: TableCell) => {
          if (!aggregatableCellIds.has(cell.id)) return undefined; // 기본 렌더로 폴백
          const selected = ownCellIds.has(cell.id);
          return (
            <label
              className={`flex h-full w-full cursor-pointer items-center justify-center gap-1.5 rounded px-1 py-2 text-xs ${
                selected ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-500'
              }`}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleOwnCell(cell.id)}
                className="h-4 w-4"
              />
              집계
            </label>
          );
        }}
      />

      {rowItems.map(({ item, index }) => (
        <div key={index} className="flex items-start gap-2">
          {isCellItem(item) ? (
            <CellRefPicker
              value={item}
              onChange={(next) => replaceAt(index, next)}
              ownQuestion={ownQuestion}
              allQuestions={allQuestions}
              // 표 오버레이와 같은 게이트를 걸어야 한다 — 계산 셀은 이 경로로도 들어올 수 없다.
              cellFilter={isAggregatableCell}
            />
          ) : (
            <div className="flex-1 text-xs text-gray-500">
              이 화면에서 편집할 수 없는 항입니다. 삭제 후 다시 추가하세요.
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-gray-400 hover:text-red-600"
            onClick={() => removeAt(index)}
            aria-label="항 삭제"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => emit([...value.items, { kind: 'cell', questionId: '', cellId: '' }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        다른 질문 셀 추가
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 컨택 메타데이터 (attrs)
// ---------------------------------------------------------------------------

interface AttrTermEditorProps {
  value: AttrExpr;
  onChange: (next: AttrExpr) => void;
}

/** 실제 attrs 키와 충돌하지 않도록 하는 "직접 입력…" 선택지 sentinel. NONE_SENTINEL 과는 별개 — 저 값은 LUT 값 컬럼 미선택 표현이라 의미가 다르다. */
const CUSTOM_ATTR_SENTINEL = '__customAttrKey__';

/**
 * attrs 키 픽커. 1순위 후보는 설문 컨택 컬럼 스킴(표시 조건의 AttrPickerSub 와 같은 소스)이지만,
 * 컨택 attrs 는 엑셀 행 통째(Record<string,string>)라 스킴에 없는 키가 흔하다 — "직접 입력…" 폴백을
 * 둔다. 직접 입력 모드 여부는 (스킴에 없는 기존 값 || 방금 고른 로컬 state)로 파생하되, 데이터의
 * SoT 는 항상 value.attrsKey — 로컬 state 는 "직접 입력…"을 막 골라 아직 빈 값인 순간만 보정한다.
 */
export function AttrTermEditor({ value, onChange }: AttrTermEditorProps) {
  const contactColumns = useSurveyBuilderStore((s) => s.currentSurvey.contactColumns?.columns);
  const attrKeys = useMemo(
    () =>
      (contactColumns ?? [])
        // pii.*/system.* 소스는 응답 런타임 contactAttrs 에 값이 오지 않는다 — attrs 소스만 후보로
        .filter((c) => c.source.startsWith('attrs.'))
        .map((c) => c.key),
    [contactColumns],
  );

  // 사용자가 "직접 입력…"을 고른 직후(값이 아직 비어 있어 스킴 미포함 판정만으로는 못 잡는 순간)를
  // 위한 최소 로컬 state. SoT 는 여전히 value.attrsKey.
  const [forceCustom, setForceCustom] = useState(false);
  const isCustom = forceCustom || (value.attrsKey !== '' && !attrKeys.includes(value.attrsKey));

  return (
    <div className="flex-1 space-y-2">
      <Select
        value={isCustom ? CUSTOM_ATTR_SENTINEL : value.attrsKey}
        onValueChange={(k) => {
          if (k === CUSTOM_ATTR_SENTINEL) {
            setForceCustom(true);
            return;
          }
          setForceCustom(false);
          onChange({ kind: 'attr', attrsKey: k });
        }}
      >
        <SelectTrigger className="h-8 w-52 text-sm" aria-label="컨택 속성 선택">
          <SelectValue placeholder="컨택 속성 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {attrKeys.length === 0 && (
            <div className="p-2 text-xs text-slate-500">설문에 컨택 컬럼이 정의되지 않았습니다</div>
          )}
          {attrKeys.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_ATTR_SENTINEL}>직접 입력…</SelectItem>
        </SelectContent>
      </Select>
      {isCustom && (
        <Input
          value={value.attrsKey}
          onChange={(e) => onChange({ kind: 'attr', attrsKey: e.target.value })}
          placeholder="컨택 속성 키 직접 입력"
          className="h-8 w-52 text-sm"
          aria-label="컨택 속성 키 직접 입력"
        />
      )}
    </div>
  );
}
