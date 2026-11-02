'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const TEST_MODE_UPLOAD_MESSAGE = '테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.';

interface ContactUploadActionProps {
  href: string;
  label: string;
  disabled: boolean;
}

/** 테스트 모드에서는 포커스·도움말은 유지하되 업로드 페이지 이동을 차단한다. */
export function ContactUploadAction({ href, label, disabled }: ContactUploadActionProps) {
  if (!disabled) {
    return (
      <Button variant="outline" size="sm" render={<Link href={href} />}>
        {label}
      </Button>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled="true"
              onClick={(event) => event.preventDefault()}
            />
          }
        >
          {label}
        </TooltipTrigger>
        <TooltipContent>{TEST_MODE_UPLOAD_MESSAGE}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { TEST_MODE_UPLOAD_MESSAGE };
