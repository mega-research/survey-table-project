'use client';

import { useEffect, useState } from 'react';

import { Image } from 'lucide-react';


/**
 * YouTube URL을 임베드 URL로 변환 (순수 함수)
 *
 * table-preview.tsx와 기타 셀 렌더링에서 공용 사용
 */
export function getYouTubeEmbedUrl(url: string) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return `https://www.youtube.com/embed/${match[2]}`;
  }
  return url;
}

/** 이미지 셀 컴포넌트 (에러 상태 관리) */
export function ImageCell({ imageUrl, content }: { imageUrl: string; content?: string }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [imageUrl]);

  return (
    <div className="flex h-full w-full flex-col items-center gap-2">
      <div key={imageUrl}>
        {error ? (
          <div className="flex items-center gap-1 text-sm text-red-500">
            <Image className="h-4 w-4" />
            <span>이미지 오류</span>
          </div>
        ) : (
          <img
            src={imageUrl}
            alt="셀 이미지"
            className="h-auto max-h-full w-full rounded object-contain"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
            onError={() => setError(true)}
          />
        )}
      </div>
      {content && <div className="mt-2 text-left text-sm text-gray-700">{content}</div>}
    </div>
  );
}
