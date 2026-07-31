'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateId } from '@/lib/utils';
import { getMaxSpssCode } from '@/utils/option-code-generator';
import type { QuestionOption } from '@/types/survey';

import { AnswerQuoteTextField } from './answer-quote-fields';

interface RankingOptionsEditorProps {
  options: QuestionOption[];
  onChange: (options: QuestionOption[]) => void;
  /** 질문 단위 응답 인용 토글 — 켜졌을 때만 옵션별 인용 문구 입력칸을 노출한다. */
  answerQuoteEnabled?: boolean | undefined;
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
}: RankingOptionsEditorProps) {
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
                    placeholder="코드"
                    className="w-20 text-xs"
                  />
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
