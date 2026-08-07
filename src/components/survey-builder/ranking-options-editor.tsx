'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, generateId } from '@/lib/utils';
import { commitOptionCode, getMaxSpssCode } from '@/utils/option-code-generator';
import type { QuestionOption } from '@/types/survey';

import { AnswerQuoteTextField } from './answer-quote-fields';

interface RankingOptionsEditorProps {
  options: QuestionOption[];
  onChange: (options: QuestionOption[]) => void;
  /** 질문 단위 응답 인용 토글 — 켜졌을 때만 옵션별 인용 문구 입력칸을 노출한다. */
  answerQuoteEnabled?: boolean | undefined;
  /**
   * optionCode blur 커밋으로 value 가 동기화되면 상위에 통보한다.
   * checkbox/radio/select 셀 에디터와 같은 pending 체인(cell-content-modal
   * pendingOptionValueChangesRef)으로 흘러 저장 시점에 일괄 리매핑된다.
   */
  onOptionValueChange?: ((change: { oldValue: string; newValue: string }) => void) | undefined;
}

/**
 * 순위형 셀(Case 3)의 옵션 리스트 편집기.
 * - label / spssNumericCode(응답값) / optionCode(변수번호) 만 편집
 * - '기타' 옵션은 셀의 allowOtherOption 토글로 별도 처리하므로 이 리스트에 포함하지 않음
 */
export function RankingOptionsEditor({
  options,
  onChange,
  answerQuoteEnabled = false,
  onOptionValueChange,
}: RankingOptionsEditorProps) {
  // optionCode blur 커밋 후 다른 옵션과 중복되는 옵션 id 집합 (경고 표시용)
  const [conflictOptionIds, setConflictOptionIds] = useState<Set<string>>(new Set());

  /**
   * optionCode Input 의 blur 커밋 — commitOptionCode 로 value 동기화를 시도한다.
   * onChange 는 타이핑마다 optionCode 필드만 갱신하고, value 동기화는 여기(blur)에서만
   * 일어난다 — 타이핑 중간값이 응답 키(value)로 새는 것을 막기 위함.
   */
  const commitCode = (index: number, code: string) => {
    const target = options[index];
    const { options: next, valueChange, conflict } = commitOptionCode(options, index, code);
    onChange(next);
    if (target) {
      setConflictOptionIds((prev) => {
        if (prev.has(target.id) === conflict) return prev;
        const nextSet = new Set(prev);
        if (conflict) nextSet.add(target.id);
        else nextSet.delete(target.id);
        return nextSet;
      });
    }
    if (valueChange) onOptionValueChange?.(valueChange);
  };

  const updateAt = (index: number, patch: Partial<QuestionOption>) => {
    const next = [...options];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch };
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  const addOption = () => {
    const nextIdx = options.length + 1;
    onChange([
      ...options,
      {
        id: generateId(),
        label: `옵션 ${nextIdx}`,
        value: `opt${nextIdx}`,
        spssNumericCode: getMaxSpssCode(options) + 1,
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>순위 선택지</Label>
        <span className="text-xs text-gray-500">{options.length}개</span>
      </div>

      {options.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
          선택지가 없습니다. 아래 &quot;옵션 추가&quot; 버튼을 눌러 추가하세요.
        </div>
      )}

      <div className="max-h-[300px] space-y-2 overflow-y-auto pr-2">
        {options.map((option, index) => (
          <div key={option.id} className="flex items-start gap-2 rounded-lg border border-gray-200 p-3">
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={option.label}
                  onChange={(e) => updateAt(index, { label: e.target.value })}
                  placeholder="옵션 텍스트"
                  className="flex-1"
                />
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-gray-400">응답값</span>
                  <Input
                    inputMode="numeric"
                    value={option.spssNumericCode ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      updateAt(index, v ? { spssNumericCode: parseInt(v, 10) } : {});
                    }}
                    placeholder={String(index + 1)}
                    className="w-14 text-center text-xs placeholder:text-gray-300"
                  />
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-gray-400">변수번호</span>
                  <Input
                    value={option.optionCode || ''}
                    onChange={(e) => updateAt(index, { optionCode: e.target.value })}
                    onBlur={() => commitCode(index, option.optionCode ?? '')}
                    placeholder="코드"
                    aria-invalid={conflictOptionIds.has(option.id)}
                    className={cn(
                      'w-20 text-xs',
                      conflictOptionIds.has(option.id) && 'border-red-500 focus-visible:ring-red-500',
                    )}
                  />
                  {conflictOptionIds.has(option.id) && (
                    <p className="w-20 text-center text-[10px] text-red-500">
                      응답값이 다른 옵션과 중복됩니다
                    </p>
                  )}
                </div>
              </div>
              {answerQuoteEnabled && (
                <AnswerQuoteTextField
                  id={`answer-quote-ranking-option-${option.id}`}
                  value={option.answerQuoteText}
                  onChange={(answerQuoteText) => updateAt(index, { answerQuoteText })}
                  showInputTokenHint={option.allowTextInput === true}
                />
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeAt(index)}
              className="text-red-500 hover:text-red-700"
            >
              삭제
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" onClick={addOption} className="w-full">
        옵션 추가
      </Button>
    </div>
  );
}
