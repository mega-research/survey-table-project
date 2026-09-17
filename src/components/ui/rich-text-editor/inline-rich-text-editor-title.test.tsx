import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineRichTextEditor } from '@/components/ui/rich-text-editor/inline-rich-text-editor';

/**
 * 제목 편집기는 평문 정본(title)을 그대로 돌려줘야 한다 — 기존 제목에 두 칸 공백이 있으면
 * 편집 후에도 남아야 SPSS·엑셀 라벨이 조용히 바뀌지 않는다(운영 문항 47개가 해당, 2026-09-17).
 */
describe('InlineRichTextEditor 제목 모드', () => {
  it('기존 제목의 연속 공백을 편집 후에도 지킨다', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <InlineRichTextEditor
        variant="title"
        initialHtml="<p>A4.  두칸  공백</p>"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    const pm = container.querySelector('.ProseMirror') as HTMLElement & {
      editor?: { commands: { insertContentAt: (pos: number, text: string) => boolean } };
    };
    act(() => {
      pm.editor?.commands.insertContentAt(1, 'X');
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'XA4.  두칸  공백' }),
    );
  });

  it('밑줄·글자 크기 도구가 있고, 셀 모드에는 없다', async () => {
    const { getByTitle, queryByTitle, unmount } = render(
      <InlineRichTextEditor variant="title" initialHtml="<p>a</p>" onChange={vi.fn()} />,
    );
    await waitFor(() => expect(getByTitle('밑줄')).toBeInTheDocument());
    expect(getByTitle('글자 크기')).toBeInTheDocument();
    unmount();

    const cell = render(<InlineRichTextEditor initialHtml="<p>a</p>" onChange={vi.fn()} />);
    await waitFor(() => expect(cell.getByTitle('굵게')).toBeInTheDocument());
    expect(queryByTitle('밑줄')).toBeNull();
    expect(cell.queryByTitle('글자 크기')).toBeNull();
  });
});
