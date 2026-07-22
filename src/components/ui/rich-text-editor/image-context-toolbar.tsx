'use client';

import { useState } from 'react';

import { useEditorState, type Editor } from '@tiptap/react';
import { MousePointerClick } from 'lucide-react';

import { ImageLinkAreaModal } from './image-link-area-modal';
import { ToolBtn } from './toolbar-primitives';

interface Props {
  editor: Editor;
  /** 클릭 영역(이미지맵) 버튼 노출 — 메일 템플릿 전용 */
  enableImageLinkArea: boolean;
}

const SIZES = [25, 50, 75, 100] as const;
type SizePct = (typeof SIZES)[number];

// 이미지 정렬은 paragraph 의 text-align 으로 통일 (paragraph toolbar 사용).
// wrapper 는 항상 inline-block — 같은 paragraph 안 여러 이미지 나란히 가능,
// 다음 paragraph/table 은 자연스럽게 새 줄. float 미사용으로 미리보기에서
// 옆으로 텍스트/표가 흘러드는 회귀 없음.
const WRAPPER_BASE =
  'display: inline-block; vertical-align: top; box-sizing: border-box;';

const IMAGE_NODE = 'imageResize';

function buildWrapperStyle(widthPct: number | null): string {
  return widthPct ? `${WRAPPER_BASE} width: ${widthPct}%;` : WRAPPER_BASE;
}

function readWidthPct(wrapperStyle: string, containerStyle: string): number | null {
  const tryMatch = (s: string) => {
    const m = s.match(/width:\s*([0-9.]+)%/);
    return m?.[1] != null ? parseFloat(m[1]) : null;
  };
  return tryMatch(wrapperStyle) ?? tryMatch(containerStyle);
}

export function ImageContextToolbar({ editor, enableImageLinkArea }: Props) {
  const [linkAreaOpen, setLinkAreaOpen] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return { active: false, widthPct: null as number | null, hasLinkArea: false };
      }
      const attrs = editor.getAttributes(IMAGE_NODE);
      const wrapperStyle = (attrs['wrapperStyle'] ?? '') as string;
      const containerStyle = (attrs['containerStyle'] ?? '') as string;
      return {
        active: editor.isActive(IMAGE_NODE),
        widthPct: readWidthPct(wrapperStyle, containerStyle),
        hasLinkArea: attrs['linkRect'] != null,
      };
    },
  });

  if (!s.active) return null;

  const setSize = (pct: SizePct) => {
    // 활성된 사이즈를 한 번 더 누르면 wrapper width 제거 → 이미지 자연 크기로 복귀.
    const isToggleOff = s.widthPct === pct;
    const wrapperStyle = buildWrapperStyle(isToggleOff ? null : pct);
    editor
      .chain()
      .focus()
      .updateAttributes(IMAGE_NODE, {
        wrapperStyle,
        containerStyle: 'width: 100%; height: auto;',
        // 드래그 resize 가 박은 px 단위 width/height attribute 가 잔존하면
        // % wrapperStyle 보다 우선되어 편집기 시각이 미리보기와 어긋난다. 같이 비움.
        width: null,
        height: null,
      })
      .run();
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-1 border-t border-gray-200 pt-2 mt-1">
      <span className="mr-1 text-xs font-medium text-gray-500">이미지 크기</span>
      {SIZES.map((pct) => (
        <ToolBtn
          key={pct}
          active={s.widthPct === pct}
          onClick={() => setSize(pct)}
          title={`이미지 ${pct}% 크기 (한 번 더 누르면 원래 크기)`}
        >
          <span className="px-1 text-xs">{pct}%</span>
        </ToolBtn>
      ))}
      {enableImageLinkArea && (
        <>
          <span className="mx-1 h-4 w-px bg-gray-200" />
          <ToolBtn
            active={s.hasLinkArea}
            onClick={() => setLinkAreaOpen(true)}
            title="클릭 영역 지정 - 설문 참여 링크"
          >
            <MousePointerClick className="h-4 w-4" />
          </ToolBtn>
        </>
      )}
      {linkAreaOpen && (
        <ImageLinkAreaModal editor={editor} onClose={() => setLinkAreaOpen(false)} />
      )}
    </div>
  );
}
