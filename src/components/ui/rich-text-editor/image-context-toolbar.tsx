'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';

import { Sep, ToolBtn } from './toolbar-primitives';

interface Props {
  editor: Editor;
}

const SIZES = [25, 50, 75, 100] as const;

// ImageResize 의 NodeView 가 읽는 wrapperStyle 패턴.
// inline: true 모드에서 좌/우 정렬은 wrapper 의 float 으로 처리되고,
// 가운데 정렬은 wrapper 를 block 으로 풀어 margin auto 를 적용한다.
const WRAPPER_LEFT = 'display: inline-block; float: left; padding-right: 8px;';
const WRAPPER_RIGHT = 'display: inline-block; float: right; padding-left: 8px;';
const WRAPPER_CENTER = 'display: block; margin: 0 auto; text-align: center;';

// ImageResize NodeView 가 사용하는 node 이름은 'image' 가 아닌 'imageResize'
const IMAGE_NODE = 'imageResize';

function readAlign(wrapperStyle: string): 'left' | 'center' | 'right' {
  if (/float:\s*right/.test(wrapperStyle)) return 'right';
  if (/display:\s*block/.test(wrapperStyle) && /margin:\s*0\s*auto/.test(wrapperStyle)) {
    return 'center';
  }
  return 'left';
}

function readWidthPct(containerStyle: string): number | null {
  const m = containerStyle.match(/width:\s*([0-9.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

export function ImageContextToolbar({ editor }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return { active: false, align: 'left' as const, widthPct: null as number | null };
      }
      const attrs = editor.getAttributes(IMAGE_NODE);
      const wrapperStyle = (attrs.wrapperStyle ?? '') as string;
      const containerStyle = (attrs.containerStyle ?? '') as string;
      return {
        active: editor.isActive(IMAGE_NODE),
        align: readAlign(wrapperStyle),
        widthPct: readWidthPct(containerStyle),
      };
    },
  });

  if (!s.active) return null;

  const setAlign = (target: 'left' | 'center' | 'right') => {
    const wrapperStyle =
      target === 'left' ? WRAPPER_LEFT : target === 'right' ? WRAPPER_RIGHT : WRAPPER_CENTER;
    editor.chain().focus().updateAttributes(IMAGE_NODE, { wrapperStyle }).run();
  };

  const setSize = (pct: number) => {
    const curr = (editor.getAttributes(IMAGE_NODE).containerStyle as string | undefined) ?? '';
    // width 만 교체. height: auto / display: inline-block 등 다른 속성은 보존.
    const cleaned = curr.replace(/width:\s*[^;]+;?\s*/g, '').trim();
    const next = `width: ${pct}%; height: auto; ${cleaned}`.trim();
    editor.chain().focus().updateAttributes(IMAGE_NODE, { containerStyle: next }).run();
  };

  return (
    <>
      <Sep />
      <ToolBtn
        active={s.align === 'left'}
        onClick={() => setAlign('left')}
        title="왼쪽 정렬"
      >
        <AlignLeft className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.align === 'center'}
        onClick={() => setAlign('center')}
        title="가운데 정렬"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.align === 'right'}
        onClick={() => setAlign('right')}
        title="오른쪽 정렬"
      >
        <AlignRight className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      {SIZES.map((pct) => (
        <ToolBtn
          key={pct}
          active={s.widthPct === pct}
          onClick={() => setSize(pct)}
          title={`${pct}% 크기`}
        >
          <span className="px-1 text-xs">{pct}%</span>
        </ToolBtn>
      ))}
    </>
  );
}
