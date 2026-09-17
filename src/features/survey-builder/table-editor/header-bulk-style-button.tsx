'use client';

import { Palette } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface HeaderBulkStyleButtonProps {
  columnCount: number;
  onOpen: () => void;
}

export function HeaderBulkStyleButton({
  columnCount,
  onOpen,
}: HeaderBulkStyleButtonProps): ReactNode {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={columnCount === 0}
      onClick={onOpen}
    >
      <Palette className="mr-1.5 h-4 w-4" />
      헤더 일괄 스타일
    </Button>
  );
}
