'use client';

import React from 'react';

import { Video } from 'lucide-react';

import { useAnswerQuotes, useContactAttrs } from '@/features/question-renderer/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { getYouTubeEmbedUrl } from '../table-cell-renderers';

import type { InteractiveCellProps, PreviewCellProps } from './types';

/** 비디오 셀 (인터랙티브 / 미리보기 동일) */
export const VideoCell = React.memo(function VideoCell({
  cell,
  content,
}: InteractiveCellProps | PreviewCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  // content 오버라이드 미지정 시 직접 치환(단일 패스) — image-cell.tsx 와 동일한 패턴.
  const caption = content ?? substituteTokens(cell.content, attrs, quotes);

  if (!cell.videoUrl) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Video className="h-4 w-4" />
        <span className="text-sm">동영상 없음</span>
      </div>
    );
  }

  const isYouTube =
    cell.videoUrl.includes('youtube.com') || cell.videoUrl.includes('youtu.be');
  const isVimeo = cell.videoUrl.includes('vimeo.com');
  const isDirectVideo = /\.(mp4|webm|ogg)$/i.test(cell.videoUrl);

  return (
    <div className="flex flex-col items-center gap-2">
      {isYouTube ? (
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
      ) : isVimeo ? (
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
      ) : isDirectVideo ? (
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
          className={cn('mt-2 text-left text-base text-gray-700', getCellTextClassName(cell))}
          style={getCellTextStyle(cell)}
        >
          {caption}
        </div>
      )}
    </div>
  );
});
