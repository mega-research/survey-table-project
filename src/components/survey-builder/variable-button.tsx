'use client';

import { PopoverVariableMenu } from '@/components/operations/mail-template/popover-variable-menu';
import type { VariableDef } from '@/components/operations/mail-template/variable-catalog';

/**
 * 단일 라인 input 옆에 부착하는 변수 메뉴 트리거.
 * 클릭 시 PopoverVariableMenu 가 떠서 키 선택 → 커서 위치에 {{key}} 삽입.
 *
 * - input의 selectionStart/End를 사용해 커서 위치에 삽입 (단순 append 가 아님)
 * - 컴포넌트 내부에서 PopoverVariableMenu 재사용 (메일/설문 동일 UI)
 */
interface Props {
  catalog: VariableDef[];
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onChange: (newValue: string) => void;
}

export function VariableButton({ catalog, inputRef, onChange }: Props) {
  const insertAtCursor = (key: string) => {
    const el = inputRef.current;
    if (!el) return;
    const token = `{{${key}}}`;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    onChange(next);
    // 커서를 토큰 끝으로 이동 — 다음 tick (state 반영 후)
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return <PopoverVariableMenu catalog={catalog} onPick={insertAtCursor} />;
}
