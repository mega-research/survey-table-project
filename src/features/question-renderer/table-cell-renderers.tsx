'use client';

/**
 * YouTube URL을 임베드 URL로 변환 (순수 함수)
 *
 * table-preview.tsx와 기타 셀 렌더링에서 공용 사용
 */
export function getYouTubeEmbedUrl(url: string) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  const videoId = match?.[2];
  if (match && videoId && videoId.length === 11) {
    return `https://www.youtube.com/embed/${videoId}`;
  }
  return url;
}
