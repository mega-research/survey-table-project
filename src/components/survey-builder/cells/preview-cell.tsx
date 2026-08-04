'use client';

import React from 'react';

import { Image as ImageIcon, Video } from 'lucide-react';

import type { TableCell } from '@/types/survey';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { cn } from '@/lib/utils';

import { getYouTubeEmbedUrl } from '../table-cell-renderers';
import { CellContentLayout } from './cell-content-layout';
import { CellOptionsContainer } from './cell-options-container';
import { ImageCell } from './image-cell';

/** 미리보기용 셀 컨텐츠 (읽기 전용)
 * choiceControlType: 보기 옵션(choice_opt) 셀의 컨트롤 종류. 질문 타입(radio/checkbox)에서
 * 내려준다. 미지정 시 'checkbox' 폴백(표 질문 등 타입 컨텍스트 없는 경우).
 * content: image/video 캡션 오버라이드. mobile-original-row-table.tsx 처럼 호출부가 이미
 * cell.content 를 치환해 넘기는 경로에서, 이 컴포넌트가 다시 치환(이중 치환)하지 않도록
 * 신호를 전달하는 opt-in 프롭 — cell-options-container.tsx 와 동일한 패턴. */
export const PreviewCell = React.memo(function PreviewCell({
  cell,
  content,
  choiceControlType = 'checkbox',
  disableControls = false,
}: {
  cell: TableCell;
  content?: string | undefined;
  choiceControlType?: 'radio' | 'checkbox';
  disableControls?: boolean;
}) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

  if (!cell) return <span className="text-sm text-gray-400">-</span>;

  switch (cell.type) {
    case 'checkbox':
      if (!cell.checkboxOptions || cell.checkboxOptions.length === 0) {
        return (
          <div className="flex items-center gap-2 text-gray-500">
            <span className="text-sm">체크박스 없음</span>
          </div>
        );
      }
      return (
        <CellOptionsContainer cell={cell}>
          {cell.checkboxOptions.map((option) => (
            // items-start + mt-0.5: 라벨(text-sm)이 2줄로 감겨도 체크박스가 첫 줄 중앙에 고정
            <div key={option.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={disableControls ? false : option.checked || false}
                disabled={disableControls}
                readOnly={!disableControls}
                className="mt-0.5 h-4 w-4 shrink-0 rounded"
              />
              <span className="whitespace-pre-line text-sm">{option.label}</span>
            </div>
          ))}
        </CellOptionsContainer>
      );

    case 'radio':
      if (!cell.radioOptions || cell.radioOptions.length === 0) {
        return (
          <div className="flex items-center gap-2 text-gray-500">
            <span className="text-sm">라디오 버튼 없음</span>
          </div>
        );
      }
      return (
        <CellOptionsContainer cell={cell}>
          {cell.radioOptions.map((option) => (
            // items-start + mt-0.5: 라벨(text-sm)이 2줄로 감겨도 라디오가 첫 줄 중앙에 고정
            <div key={option.id} className="flex items-start gap-2">
              <input
                type="radio"
                name={`preview-${cell.id}`}
                checked={disableControls ? false : option.selected || false}
                disabled={disableControls}
                readOnly={!disableControls}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="whitespace-pre-line text-sm">{option.label}</span>
            </div>
          ))}
        </CellOptionsContainer>
      );

    case 'select':
      return cell.selectOptions && cell.selectOptions.length > 0 ? (
        <CellContentLayout content={cell.content} position={cell.textPosition} bold={cell.textBold}>
          <select className="w-full rounded border border-gray-300 p-2 text-sm" disabled>
            <option value="">선택하세요...</option>
            {cell.selectOptions.map((option) => (
              <option key={option.id} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </CellContentLayout>
      ) : (
        <div className="flex items-center gap-2 text-gray-500">
          <span className="text-sm">선택 옵션 없음</span>
        </div>
      );

    case 'image':
      return cell.imageUrl ? (
        <ImageCell cell={cell} content={content} cellResponse={undefined} onUpdateValue={() => {}} />
      ) : (
        <div className="flex items-center gap-2 text-gray-500">
          <ImageIcon className="h-4 w-4" />
          <span className="text-sm">이미지 없음</span>
        </div>
      );

    case 'video': {
      // 델리게이션이 아닌 인라인 렌더 — image 케이스와 달리 VideoCell 컴포넌트를 거치지
      // 않으므로 여기서 직접 치환한다. content 오버라이드 미지정 시(직접 호출 경로)
      // cell.content 를 치환, 지정 시(mobile-original-row-table.tsx 사전 치환 경로)
      // 그대로 사용해 이중 치환을 피한다.
      const caption = content ?? substituteTokens(cell.content, attrs, quotes);
      return cell.videoUrl ? (
        <div className="flex flex-col items-center gap-2">
          {cell.videoUrl.includes('youtube.com') || cell.videoUrl.includes('youtu.be') ? (
            <div className="w-full max-w-xs">
              <div className="aspect-video">
                <iframe
                  src={getYouTubeEmbedUrl(cell.videoUrl)}
                  className="h-full w-full rounded"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="테이블 동영상"
                />
              </div>
            </div>
          ) : cell.videoUrl.includes('vimeo.com') ? (
            <div className="w-full max-w-xs">
              <div className="aspect-video">
                <iframe
                  src={cell.videoUrl.replace('vimeo.com/', 'player.vimeo.com/video/')}
                  className="h-full w-full rounded"
                  frameBorder="0"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  title="테이블 동영상"
                />
              </div>
            </div>
          ) : cell.videoUrl.match(/\.(mp4|webm|ogg)$/i) ? (
            <video src={cell.videoUrl} controls className="max-h-32 w-full max-w-xs rounded">
              동영상을 지원하지 않는 브라우저입니다.
            </video>
          ) : (
            <div className="flex items-center gap-2 text-yellow-600">
              <Video className="h-4 w-4" />
              <span className="text-sm">동영상 링크 오류</span>
            </div>
          )}
          {caption && (
            <div
              className={cn('mt-2 text-left text-sm text-gray-700', getCellTextClassName(cell))}
              style={getCellTextStyle(cell)}
            >
              {caption}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-gray-500">
          <Video className="h-4 w-4" />
          <span className="text-sm">동영상 없음</span>
        </div>
      );
    }

    case 'input':
      return (
        <CellContentLayout content={cell.content} position={cell.textPosition} bold={cell.textBold}>
          <div className="flex flex-col space-y-2">
            <input
              type="text"
              placeholder={cell.placeholder || '답변을 입력하세요...'}
              maxLength={cell.inputMaxLength}
              disabled
              className="w-full rounded border border-gray-300 bg-gray-50 p-2 text-sm"
            />
            {cell.inputMaxLength && (
              <div className="mt-1 text-right text-xs text-gray-500">
                최대 {cell.inputMaxLength}자
              </div>
            )}
          </div>
        </CellContentLayout>
      );

    case 'ranking_opt':
      // 랭킹 옵션 소스 셀 — 읽기 전용으로 이미지 + 라벨 표시
      return (
        <div className="flex flex-col gap-1">
          {cell.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cell.imageUrl}
              alt={cell.content || cell.rankingLabel || '순위 옵션'}
              className="h-16 w-full rounded object-cover"
            />
          )}
          {cell.content && (
            <div
              className={cn(
                'text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-gray-800',
                getCellTextClassName(cell),
              )}
              style={getCellTextStyle(cell)}
            >
              {cell.content}
            </div>
          )}
        </div>
      );

    case 'ranking':
      // 셀 내부 랭킹 (rk) — 프리뷰에서는 간단히 안내만
      return (
        <CellContentLayout content={cell.content} position={cell.textPosition} bold={cell.textBold}>
          <div className="text-xs text-gray-500">
            (순위형 셀 · {cell.rankingOptions?.length ?? 0}개 옵션 ·{' '}
            {cell.rankingConfig?.positions ?? 3}순위)
          </div>
        </CellContentLayout>
      );

    case 'choice_opt': {
      // 보기 옵션 셀 — 프리뷰에서는 체크박스 표시 (실제 응답은 ChoiceTableResponse 가 렌더).
      // 셀 표시는 셀 텍스트(content) 전용 — choiceLabel 은 데이터로만 저장 (응답 렌더와 동일 규칙).
      const choiceLabelText = (cell.content ?? '').trim();
      return (
        <div className="flex items-center justify-center gap-2">
          <input
            type={choiceControlType}
            disabled
            className="h-4 w-4"
            aria-label={cell.choiceLabel || '보기 선택'}
          />
          {choiceLabelText && (
            <span
              className={cn('text-sm text-gray-700', getCellTextClassName(cell))}
              style={getCellTextStyle(cell)}
            >
              {choiceLabelText}
            </span>
          )}
        </div>
      );
    }

    default:
      return cell.content ? (
        <div
          className={cn(
            'text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap',
            getCellTextClassName(cell),
          )}
          style={getCellTextStyle(cell)}
        >
          {cell.content}
        </div>
      ) : (
        <span className="text-sm text-gray-400" />
      );
  }
});
