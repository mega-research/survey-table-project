// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 재현 프로브 — 편집 세션 안에서 이미지 크기 변경 ↔ 색상 변경이 서로를 풀어버리는지.
 * question-basic-tab 과 동일한 initialHtml/onChange 왕복(useState 직결) 위에서
 * 실제 RichTextEditor(동기화 이펙트 포함)를 마운트해 사용자 조작 순서를 시뮬레이트한다.
 */

vi.mock('@/shared/lib/rpc', () => ({ client: {} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { RichTextEditor } from '@/components/ui/rich-text-editor';
import type { RichTextEditorHandle } from '@/components/ui/rich-text-editor';

const STORED =
  '<p style="text-align: center;"><span style="color: rgb(255, 0, 0);">경품 안내</span></p>' +
  '<p style="text-align: center;"><img src="https://x.test/a.webp" ' +
  'wrapperstyle="display: inline-block; vertical-align: top; box-sizing: border-box; width: 50%" ' +
  'containerstyle="width: 100%; height: auto;" ' +
  'style="display: inline-block; vertical-align: top; box-sizing: border-box; width: 50%; height: auto; max-width: 100%;"></p>';

function Harness({
  editorRef,
  htmlRef,
}: {
  editorRef: React.MutableRefObject<RichTextEditorHandle | null>;
  htmlRef: React.MutableRefObject<string>;
}) {
  const [html, setHtml] = useState(STORED);
  return (
    <RichTextEditor
      ref={(h) => {
        editorRef.current = h as RichTextEditorHandle;
      }}
      kind="survey"
      initialHtml={html}
      onChange={(next) => {
        htmlRef.current = next;
        setHtml(next);
      }}
      variableCatalog={[]}
    />
  );
}

async function flush() {
  // 동기화 이펙트·NodeView 후속 트랜잭션이 소진될 때까지 몇 사이클 돌린다
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function findImagePos(editor: NonNullable<ReturnType<RichTextEditorHandle['getEditor']>>): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'imageResize' && pos === -1) pos = p;
    return true;
  });
  return pos;
}

describe('편집 세션 내 서식 상호 손실 재현', () => {
  afterEach(cleanup);

  it('이미지 크기를 바꿔도 글자색이 유지되고, 색을 바꿔도 이미지 크기가 유지된다', async () => {
    const editorRef = { current: null as RichTextEditorHandle | null };
    const htmlRef = { current: STORED };
    render(<Harness editorRef={editorRef} htmlRef={htmlRef} />);
    await flush();

    const editor = editorRef.current?.getEditor();
    if (!editor) throw new Error('editor not ready');

    // 초기 상태 확인
    expect(htmlRef.current).toContain('rgb(255, 0, 0)');
    expect(htmlRef.current).toMatch(/width:\s*50%/);

    // 1) 이미지 크기 25% — image-context-toolbar setSize 와 동일한 조작
    const imagePos = findImagePos(editor);
    expect(imagePos).toBeGreaterThan(-1);
    await act(async () => {
      editor
        .chain()
        .setNodeSelection(imagePos)
        .updateAttributes('imageResize', {
          wrapperStyle:
            'display: inline-block; vertical-align: top; box-sizing: border-box; width: 25%;',
          containerStyle: 'width: 100%; height: auto;',
          width: null,
          height: null,
        })
        .run();
    });
    await flush();

    // 크기 변경 후에도 글자색 생존해야 한다
    expect(htmlRef.current).toMatch(/width:\s*25%/);
    expect(htmlRef.current).toContain('rgb(255, 0, 0)');

    // 2) 글자색 변경 — 첫 문단 텍스트 선택 후 fontColor 적용
    await act(async () => {
      editor.chain().setTextSelection({ from: 1, to: 6 }).setMark('fontColor', {
        color: '#0000ff',
      }).run();
    });
    await flush();

    // 색 변경 후에도 이미지 크기 생존해야 한다
    expect(htmlRef.current).toMatch(/color:\s*(#0000ff|rgb\(0,\s*0,\s*255\))/);
    expect(htmlRef.current).toMatch(/width:\s*25%/);

    // 3) 최종 왕복 안정성 — 지금 상태로 재마운트해도 동일해야 한다 (저장 후 재열기)
    const savedHtml = htmlRef.current;
    cleanup();
    const editorRef2 = { current: null as RichTextEditorHandle | null };
    const htmlRef2 = { current: savedHtml };
    function Harness2() {
      const [html, setHtml] = useState(savedHtml);
      return (
        <RichTextEditor
          ref={(h) => {
            editorRef2.current = h as RichTextEditorHandle;
          }}
          kind="survey"
          initialHtml={html}
          onChange={(next) => {
            htmlRef2.current = next;
            setHtml(next);
          }}
          variableCatalog={[]}
        />
      );
    }
    render(<Harness2 />);
    await flush();
    expect(htmlRef2.current).toMatch(/width:\s*25%/);
    expect(htmlRef2.current).toMatch(/color:\s*(#0000ff|rgb\(0,\s*0,\s*255\))/);
  }, 30000);
});
