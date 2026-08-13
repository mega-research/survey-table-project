'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/get-error-message';

interface Props {
  previewToken: string;
}

/**
 * 배포된 설문을 로그인 없이 읽기 전용으로 볼 수 있는 공개 링크(`/preview/[token]`)를
 * 클립보드에 복사한다. `previewToken`은 DB 컬럼이라 직접 조회 없이는 알 수 없으므로,
 * 이 버튼이 사실상 유일한 발급 경로다. 어드민·게스트 공용 — isGuest로 가리지 않는다.
 *
 * privateToken(응답 크레덴셜)이 아니라 previewToken을 쓴다 — 미리보기 링크 공유가
 * 곧 응답 제출 권한 공유가 되는 것을 막기 위해 분리된 컬럼이다.
 */
export function CopyPreviewLinkButton({ previewToken }: Props) {
  const copyLink = async () => {
    try {
      const url = `${window.location.origin}/preview/${previewToken}`;
      await navigator.clipboard.writeText(url);
      toast.success('공개 미리보기 링크를 복사했습니다.');
    } catch (err) {
      toast.error(getErrorMessage(err, '클립보드 복사에 실패했습니다.'));
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
      <Copy className="mr-2 h-4 w-4" />
      공개 링크 복사
    </Button>
  );
}
