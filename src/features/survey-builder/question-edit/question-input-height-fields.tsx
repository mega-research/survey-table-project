'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { isInputFormat } from '@/types/input-type';
import type { Question } from '@/types/survey';

interface QuestionInputHeightFieldsProps {
  questionType: 'text' | 'textarea';
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
}

/**
 * 단답형·장문형 입력칸 높이 — 줄 수와 입력한 만큼 높이 늘리기. 표 input 셀 설정과 같은 문구·규칙이다.
 * 단답형은 기본 한 줄, 장문형은 기본 4줄이고, 숫자·입력 형식 칸은 한 줄 고정이라 잠근다.
 */
export function QuestionInputHeightFields({
  questionType,
  formData,
  setFormData,
}: QuestionInputHeightFieldsProps) {
  const locked =
    questionType === 'text' &&
    (formData.inputType === 'number' || isInputFormat(formData.inputType));
  const defaultRows = questionType === 'textarea' ? 4 : 1;
  const rows = formData.inputRows ?? null;
  const effectiveRows = rows ?? defaultRows;

  const rowsHint = locked
    ? '숫자·형식 칸은 한 줄로 고정입니다'
    : effectiveRows >= 2
      ? `${effectiveRows}줄 높이의 여러 줄 입력칸으로 그려집니다`
      : '2 이상으로 두면 여러 줄 입력칸이 됩니다';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="question-input-rows">입력칸 줄 수</Label>
        <Input
          id="question-input-rows"
          type="number"
          min={1}
          max={20}
          value={rows ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              setFormData((prev) => ({ ...prev, inputRows: null }));
              return;
            }
            const num = parseInt(raw, 10);
            if (!isNaN(num) && num >= 1 && num <= 20) {
              setFormData((prev) => ({ ...prev, inputRows: num }));
            }
          }}
          placeholder={questionType === 'textarea' ? '4 (기본)' : '1 (한 줄)'}
          disabled={locked}
          className="mt-2 w-full"
        />
        <p className="text-xs text-gray-500">{rowsHint}</p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="question-input-auto-grow" className="text-sm font-medium">
            입력한 만큼 높이 늘리기
          </Label>
          <p className="mt-0.5 text-xs text-gray-500">
            {locked
              ? '숫자·형식 칸은 한 줄로 고정입니다'
              : '응답자가 글을 쓰면 입력칸이 함께 커집니다. 줄 수는 처음 높이가 됩니다'}
          </p>
        </div>
        <Switch
          id="question-input-auto-grow"
          checked={formData.inputAutoGrow === true}
          onCheckedChange={(checked) =>
            setFormData((prev) => ({ ...prev, inputAutoGrow: checked ? true : null }))
          }
          disabled={locked}
        />
      </div>
    </div>
  );
}
