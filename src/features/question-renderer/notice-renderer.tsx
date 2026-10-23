'use client';

import { useMemo, useRef, useState } from 'react';

import { Label } from '@/components/ui/label';
import { sanitizeRichHtml } from '@/lib/sanitize';

import { RICH_TEXT_ENLARGE_CLASS, useRichTextImageEnlarge } from './rich-text-image-enlarge';

interface NoticeRendererProps {
  content: string;
  /** 패널 배경색 — 미지정=기본 파랑, 'none'=무색(패널 제거), '#rrggbb'=커스텀 */
  bgColor?: string | undefined;
  requiresAcknowledgment?: boolean | undefined;
  value?: boolean | undefined;
  onChange?: (acknowledged: boolean) => void;
  /**
   * 'preview' 는 빌더 편집 미리보기 — onChange 가 없어도 확인 컨트롤을 조작 가능한
   * 모습으로 보여준다. 응답 수집 여부와 무관한 표시 정책이라 렌더러가 직접 안다.
   */
  mode?: 'live' | 'preview' | undefined;
}

/** 기본 파란 패널(bg-blue-50/40 over white)의 실효색 — 토글을 켤 때 픽커 시작값 */
export const NOTICE_BG_DEFAULT_HEX = '#f9fbff';

/** 배경색에서 파생하는 패널 테두리색 — 각 채널을 12% 어둡게 */
function deriveBorderColor(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const darken = (c: number) => Math.max(0, Math.round(c * 0.88));
  const r = darken((n >> 16) & 0xff);
  const g = darken((n >> 8) & 0xff);
  const b = darken(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function NoticeRenderer({
  content,
  bgColor,
  requiresAcknowledgment = false,
  value = false,
  onChange,
  mode = 'live',
}: NoticeRendererProps) {
  const [acknowledged, setAcknowledged] = useState(value);
  const html = sanitizeRichHtml(content);
  const panelRef = useRef<HTMLDivElement>(null);
  const imageEnlarge = useRichTextImageEnlarge(panelRef, html);
  // 본문 객체를 고정한다 — 새 객체면 React 가 다시 그릴 때마다 본문을 통째로 다시 넣어, 크게 보기
  // 표식을 붙인 이미지가 표식 없는 새 이미지로 바뀐다(돋보기 자리·크게 보기 상태가 바뀌어도 다시 그린다)
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  const handleAcknowledgmentChange = (checked: boolean) => {
    setAcknowledged(checked);
    onChange?.(checked);
  };

  // 패널 스타일 분기 — 미지정=기본 파랑, 'none'=패널 제거, hex=지정색+파생 테두리
  const isNoPanel = bgColor === 'none';
  const customBg = bgColor && !isNoPanel ? bgColor : null;
  const panelClass = isNoPanel
    ? ''
    : customBg
      ? 'rounded-lg border p-6'
      : 'rounded-lg border border-blue-100 bg-blue-50/40 p-6';

  return (
    <div className="space-y-4">
      {/* Rich Text Content Display — 터치 기기 돋보기가 본문 상자 기준으로 뜨도록 relative 로 감싼다 */}
      <div className="relative">
        <div
          ref={panelRef}
          {...imageEnlarge.enlargeProps}
          data-notice-panel
          // max-md word-break normal: 전역 keep-all(어절 보존)이 좁은 화면의 긴 문단에서
          // 줄 끝 빈 공간을 크게 남겨, 공지 본문은 모바일에서만 글자 단위 줄바꿈을 허용한다.
          // (justify 분산 정렬은 문단 인라인 text-align 에 밀려 무효 — 시도 후 기각)
          className={`tiptap-mobile-tame prose prose-sm max-w-none min-w-0 ${panelClass} max-md:[word-break:normal] md:overflow-x-auto [&_a.notice-file-attachment]:inline-flex [&_a.notice-file-attachment]:items-center [&_a.notice-file-attachment]:bg-gray-100 [&_a.notice-file-attachment]:text-gray-700 [&_a.notice-file-attachment]:no-underline [&_a.notice-file-attachment_.notice-file-attachment-label]:text-gray-800 [&_a.notice-file-attachment_.notice-file-attachment-meta]:text-gray-500 [&_a:not(.notice-file-attachment)]:[overflow-wrap:anywhere] [&_img]:inline-block [&_img]:align-top [&_p]:min-h-[1.6em] [&_p]:break-words [&_table]:my-4 [&_table]:max-w-full [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-300 md:[&_table]:!w-auto [&_table_p]:m-0 [&_table_td]:box-border [&_table_td]:overflow-hidden [&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-3 [&_table_td]:py-2 [&_table_td]:align-top [&_table_td]:break-words [&_table_th]:box-border [&_table_th]:overflow-hidden [&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:bg-transparent [&_table_th]:px-3 [&_table_th]:py-2 [&_table_th]:align-top [&_table_th]:font-normal [&_table_th]:break-words ${RICH_TEXT_ENLARGE_CLASS}`}
          dangerouslySetInnerHTML={innerHtml}
          style={{
            // TipTap 스타일 재정의
            fontSize: '14px',
            lineHeight: '1.6',
            WebkitOverflowScrolling: 'touch',
            ...(customBg
              ? { backgroundColor: customBg, borderColor: deriveBorderColor(customBg) }
              : {}),
          }}
        />
        {imageEnlarge.badges}
      </div>
      {imageEnlarge.overlay}

      {/* Acknowledgment Checkbox */}
      {requiresAcknowledgment && (
        <div className="flex items-start space-x-3 rounded-lg border border-gray-200 bg-white p-4">
          <input
            type="radio"
            id="acknowledgment-check"
            checked={acknowledged}
            onChange={(e) => handleAcknowledgmentChange(e.target.checked)}
            className="mt-0.5 h-5 w-5 border-gray-300 text-blue-600 focus:ring-blue-500"
            disabled={mode === 'live' && !onChange}
          />
          <Label
            htmlFor="acknowledgment-check"
            className="flex-1 cursor-pointer text-sm font-medium text-gray-900"
          >
            위 내용을 읽고 이해했습니다.
          </Label>
        </div>
      )}

      {requiresAcknowledgment && !acknowledged && (
        <div className="rounded bg-red-50 p-2 text-xs text-red-600">
          ⚠️ 위 내용을 확인하고 체크해주세요.
        </div>
      )}
    </div>
  );
}
