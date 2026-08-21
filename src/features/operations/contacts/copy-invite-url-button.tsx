'use client';

import { useState } from 'react';

import { Copy, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { buildInviteUrl } from '@/lib/survey-url';

interface Props {
  inviteCode: string;
}

export function CopyInviteUrlButton({ inviteCode }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const url = buildInviteUrl(inviteCode);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
      window.prompt('아래 링크를 복사하세요', url);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="gap-2">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? '복사됨' : '응답 링크 복사'}
    </Button>
  );
}
