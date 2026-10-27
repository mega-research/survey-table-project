// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/rpc', () => ({ client: {} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { RichTextEditor } from '@/components/ui/rich-text-editor';
import type { RichTextEditorHandle } from '@/components/ui/rich-text-editor';

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

/**
 * 바깥에서 바꾼 `initialHtml`(보관함 불러오기·템플릿 다시 읽기)이 편집기 본문에 반영된다.
 * 편집기는 첫 렌더에 아직 없으므로(`immediatelyRender: false`), 동기화가 첫 렌더 값을 읽으면
 * 늘 「편집기 없음」으로 끝나 반영되지 않는다(주의사항 17).
 */
describe('RichTextEditor — initialHtml 동기화', () => {
  afterEach(cleanup);

  it('편집기가 만들어진 뒤 initialHtml 이 바뀌면 본문을 그 값으로 바꾼다', async () => {
    const handle = { current: null as RichTextEditorHandle | null };
    const view = (html: string) => (
      <RichTextEditor
        ref={(h) => {
          handle.current = h;
        }}
        kind="survey"
        initialHtml={html}
        onChange={() => {}}
        variableCatalog={[]}
      />
    );
    const { rerender } = render(view('<p>처음 글</p>'));
    await flush();
    expect(handle.current?.getEditor()?.getHTML()).toContain('처음 글');

    rerender(view('<p>불러온 글</p>'));
    await flush();
    expect(handle.current?.getEditor()?.getHTML()).toContain('불러온 글');
  });
});
