'use client';

import Link from 'next/link';

import { ChevronDown, Eye, FileText, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useHoverMenu } from './hover-toggle-menu';

/**
 * 운영 헤더의 「설문 열기」 — 설문 보기(미리보기)와 설문 편집을 한 메뉴로 묶는다.
 *
 * 테스트 모드·설문 중단/종료와 같은 모양이다(버튼은 메뉴만 열고 호버로도 열린다). 편집이 든
 * 메뉴라 `survey.edit` 를 가진 내부 셸에서만 쓴다 — 볼 수만 있는 주체(링크 셸·팀원)는 헤더가
 * 「설문 보기」 버튼 하나를 그대로 그린다.
 */
export function SurveyOpenMenu({
  previewHref,
  editHref,
}: {
  previewHref: string | null;
  editHref: string;
}) {
  const menu = useHoverMenu();
  return (
    <DropdownMenu open={menu.open} onOpenChange={menu.setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button {...menu.triggerProps} type="button" variant="outline" size="sm">
          <FileText className="mr-2 h-4 w-4" />
          설문 열기
          <ChevronDown className="ml-1 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]" {...menu.contentProps}>
        {previewHref && (
          <DropdownMenuItem asChild>
            <Link href={previewHref}>
              <Eye className="mr-2 h-4 w-4" />
              설문 보기
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href={editHref}>
            <Pencil className="mr-2 h-4 w-4" />
            설문 편집
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
