'use client';

import { Quote } from 'lucide-react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { QuestionType } from '@/types/survey';

/**
 * 응답 인용(answer quote) 빌더 컨트롤 모음.
 *
 * 수집기(lib/survey/answer-quote.ts)가 읽는 필드를 그대로 편집한다 —
 * 질문 단위 `answerQuoteEnabled`/`answerQuoteName`/`answerQuoteText`,
 * 옵션·셀 단위 `answerQuoteText`.
 */

/** 인용을 수집할 수 있는 질문 유형 — 수집기의 분기와 1:1 (textarea/notice 는 대상 아님). */
const ANSWER_QUOTE_QUESTION_TYPES: readonly QuestionType[] = [
  'text',
  'radio',
  'checkbox',
  'select',
  'multiselect',
  'ranking',
  'table',
];

export function supportsAnswerQuote(type: QuestionType): boolean {
  return ANSWER_QUOTE_QUESTION_TYPES.includes(type);
}

/** `{{입력}}` 치환 힌트 — 주관식 옵션·입력 셀·단답형에서만 노출한다. */
export const ANSWER_QUOTE_INPUT_TOKEN_HINT =
  '{{입력}} 을 쓰면 응답자가 입력한 값이 들어갑니다';

/** 인용 이름을 실제 참조 토큰 문자열로 만든다. */
export function answerQuoteToken(name: string): string {
  return `{{{${name.trim()}}}}`;
}

interface AnswerQuoteTextFieldProps {
  value: string | undefined;
  onChange: (value: string) => void;
  /**
   * 'option' — 옵션이 선택돼야 수집되고, 문구가 비면 인용에서 제외된다.
   * 'input'  — 값이 있으면 수집되고, 문구가 비면 응답자 입력값을 그대로 쓴다.
   */
  mode?: 'option' | 'input';
  /** `{{입력}}` 치환이 가능한 자리인지 (주관식 옵션 / 입력 셀 / 단답형) */
  showInputTokenHint?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

/** 옵션·셀·단답형 한 칸의 인용 문구 입력칸. */
export function AnswerQuoteTextField({
  value,
  onChange,
  mode = 'option',
  showInputTokenHint,
  id,
  className,
}: AnswerQuoteTextFieldProps) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <Label htmlFor={id} className="text-xs text-gray-600">
        인용 문구
      </Label>
      <Input
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          mode === 'input'
            ? '비우면 응답자가 입력한 값이 그대로 들어갑니다'
            : '비우면 이 선택지는 인용되지 않습니다'
        }
        className="h-8 text-xs"
      />
      {showInputTokenHint && (
        <p className="text-[11px] text-gray-500">{ANSWER_QUOTE_INPUT_TOKEN_HINT}</p>
      )}
    </div>
  );
}

interface AnswerQuoteQuestionControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  /**
   * 단답형(text) 전용 — 옵션이 없어 질문 자체가 입력 단위 후보 하나다.
   * 넘기지 않으면 질문 단위 문구 입력칸을 렌더하지 않는다.
   */
  questionText?:
    | {
        value: string | undefined;
        onChange: (value: string) => void;
      }
    | undefined;
}

/**
 * 질문 단위 응답 인용 설정 — 토글 + 인용 이름 + 참조 토큰 + 안내.
 *
 * 토글을 끌 때 옵션·셀에 입력된 문구는 건드리지 않는다 (다시 켜면 그대로 복귀).
 */
export function AnswerQuoteQuestionControl({
  enabled,
  onEnabledChange,
  name,
  onNameChange,
  questionText,
}: AnswerQuoteQuestionControlProps) {
  const trimmedName = name.trim();
  const token = answerQuoteToken(name);

  const copyToken = () => {
    if (!trimmedName) return;
    navigator.clipboard
      ?.writeText(token)
      .then(() => toast.success('인용 토큰을 복사했습니다'))
      .catch(() => toast.error('복사에 실패했습니다. 직접 선택해 복사하세요'));
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="answer-quote-enabled" className="flex items-center gap-2 text-sm font-medium">
          <Quote className="h-4 w-4" />
          응답 인용
        </Label>
        <Switch
          id="answer-quote-enabled"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="answer-quote-name" className="text-xs text-gray-600">
              인용 이름
            </Label>
            <Input
              id="answer-quote-name"
              value={name}
              // 중괄호가 이름에 섞이면 {{{이름}}} 토큰 파싱이 깨져 영구 미스매치가 된다
              // (TOKEN_PATTERN 문자 클래스가 [^{}]+) — 입력 단계에서 원천 차단.
              onChange={(e) => onNameChange(e.target.value.replace(/[{}]/g, ''))}
              placeholder="예: 마케팅유형"
              className="h-8 text-sm"
            />
            <p className="text-xs text-gray-500">
              다른 질문에서{' '}
              {trimmedName ? (
                <button
                  type="button"
                  onClick={copyToken}
                  title="클릭하면 복사됩니다"
                  className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-xs text-blue-700 hover:bg-blue-100"
                >
                  {token}
                </button>
              ) : (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-400">
                  {'{{{인용이름}}}'}
                </span>
              )}{' '}
              으로 참조합니다.
            </p>
          </div>

          {questionText && (
            <AnswerQuoteTextField
              id="answer-quote-text"
              value={questionText.value}
              onChange={questionText.onChange}
              mode="input"
              showInputTokenHint
            />
          )}

          <p className="rounded bg-amber-50 p-2 text-xs leading-relaxed text-amber-800">
            인용 결과가 비면 문장이 깨집니다. 이 인용을 제목에 쓰는 뒤 질문에
            &quot;이 질문에 응답이 있을 때만 표시&quot; 조건을 함께 걸어두세요.
            이 질문이 조건으로 숨겨진 경우에도 같은 조건이 뒤 질문의 문장을 지켜줍니다.
          </p>
        </div>
      )}
    </div>
  );
}
