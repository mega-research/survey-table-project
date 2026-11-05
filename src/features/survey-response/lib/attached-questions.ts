import type { StepItem } from '@/utils/group-ordering';

/**
 * 앞 문항 설명 밑에 붙이기(`Question.collapseAttachToPrevious`) — 페이지에 보이는 문항 목록을 「제자리에 그릴 문항」과
 * 「앞 문항 설명 밑에 들어갈 문항」으로 가른다. 접어 두기(버튼 글자)를 켠 문항만 붙고, 붙일 앞 문항은 페이지에서 바로 앞에
 * **제자리로 그려지는** 문항이다 — 연달아 붙이면 같은 앞 문항에 차례로 붙는다. 앞에 그릴 문항이 없으면(페이지 첫 문항)
 * 제자리에 그린다. 목록은 표시 조건을 이미 거른 것이어야 한다(숨은 앞 문항에 붙지 않게).
 */
export function groupAttachedItems(items: readonly StepItem[]): {
  rendered: StepItem[];
  attachments: Map<string, StepItem[]>;
} {
  const rendered: StepItem[] = [];
  const attachments = new Map<string, StepItem[]>();
  for (const item of items) {
    const q = item.question;
    const host = rendered[rendered.length - 1];
    if (
      q.collapseAttachToPrevious === true &&
      (q.collapseButtonLabel ?? '').trim() !== '' &&
      host
    ) {
      attachments.set(host.question.id, [...(attachments.get(host.question.id) ?? []), item]);
      continue;
    }
    rendered.push(item);
  }
  return { rendered, attachments };
}
