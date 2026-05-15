'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';

import { Sep, ToolBtn } from './toolbar-primitives';

interface Props {
  editor: Editor;
}

type Align = 'left' | 'center' | 'right';

const SIZES = [25, 50, 75, 100] as const;
type SizePct = (typeof SIZES)[number];

// ImageResize NodeView 의 wrapper 에 적용되는 style.
// 폭을 wrapper 에 직접 박고 box-sizing: border-box 로 padding 을 폭 내부에 포함시켜
// 4개 25% 가 부모 폭 100% 안에 정확히 나란히 들어가도록 한다.
const ALIGN_BASE: Record<Align, string> = {
  left: 'display: inline-block; float: left; vertical-align: top; box-sizing: border-box; padding-right: 4px;',
  right:
    'display: inline-block; float: right; vertical-align: top; box-sizing: border-box; padding-left: 4px;',
  center:
    'display: block; margin: 0 auto; vertical-align: top; box-sizing: border-box;',
};

const IMAGE_NODE = 'imageResize';

function buildWrapperStyle(align: Align, widthPct: number): string {
  return `${ALIGN_BASE[align]} width: ${widthPct}%;`;
}

function readAlign(wrapperStyle: string): Align {
  if (/float:\s*right/.test(wrapperStyle)) return 'right';
  if (/display:\s*block/.test(wrapperStyle) && /margin:\s*0\s*auto/.test(wrapperStyle)) {
    return 'center';
  }
  return 'left';
}

function readWidthPct(wrapperStyle: string, containerStyle: string): number | null {
  const tryMatch = (s: string) => {
    const m = s.match(/width:\s*([0-9.]+)%/);
    return m ? parseFloat(m[1]) : null;
  };
  return tryMatch(wrapperStyle) ?? tryMatch(containerStyle);
}

export function ImageContextToolbar({ editor }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return { active: false, align: 'left' as Align, widthPct: null as number | null };
      }
      const attrs = editor.getAttributes(IMAGE_NODE);
      const wrapperStyle = (attrs.wrapperStyle ?? '') as string;
      const containerStyle = (attrs.containerStyle ?? '') as string;
      return {
        active: editor.isActive(IMAGE_NODE),
        align: readAlign(wrapperStyle),
        widthPct: readWidthPct(wrapperStyle, containerStyle),
      };
    },
  });

  if (!s.active) return null;

  // 기본 폭은 50%. 사용자가 정렬만 누르고 폭은 안 누른 상태에서도 합리적 기본값을 갖는다.
  const currentWidth: SizePct = (s.widthPct && SIZES.includes(s.widthPct as SizePct)
    ? (s.widthPct as SizePct)
    : 50) as SizePct;

  const apply = (align: Align, widthPct: number) => {
    const wrapperStyle = buildWrapperStyle(align, widthPct);
    // containerStyle 은 wrapper 폭의 100% 를 차지. NodeView 가 container 에 적용.
    const containerStyle = 'width: 100%; height: auto;';
    editor
      .chain()
      .focus()
      .updateAttributes(IMAGE_NODE, { wrapperStyle, containerStyle })
      .run();
  };

  const setAlign = (target: Align) => apply(target, currentWidth);
  const setSize = (pct: SizePct) => apply(s.align, pct);

  return (
    <div className="flex w-full flex-wrap items-center gap-1 border-t border-gray-200 pt-2 mt-1">
      <span className="mr-1 text-xs font-medium text-gray-500">이미지</span>
      <ToolBtn
        active={s.align === 'left'}
        onClick={() => setAlign('left')}
        title="이미지 왼쪽 정렬"
      >
        <AlignLeft className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.align === 'center'}
        onClick={() => setAlign('center')}
        title="이미지 가운데 정렬"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.align === 'right'}
        onClick={() => setAlign('right')}
        title="이미지 오른쪽 정렬"
      >
        <AlignRight className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      {SIZES.map((pct) => (
        <ToolBtn
          key={pct}
          active={s.widthPct === pct}
          onClick={() => setSize(pct)}
          title={`이미지 ${pct}% 크기`}
        >
          <span className="px-1 text-xs">{pct}%</span>
        </ToolBtn>
      ))}
    </div>
  );
}
