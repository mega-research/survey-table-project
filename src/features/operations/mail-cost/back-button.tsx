'use client';

import { useRouter } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';

const FALLBACK_HREF = '/admin/surveys';

export function BackButton() {
  const router = useRouter();

  const handleClick = () => {
    const referrer = document.referrer;
    if (referrer) {
      try {
        if (new URL(referrer).origin === window.location.origin) {
          router.back();
          return;
        }
      } catch {
        // referrer parse 실패 시 fallback
      }
    }
    router.push(FALLBACK_HREF);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleClick}>
      <ArrowLeft className="mr-2 h-4 w-4" />
      이전
    </Button>
  );
}
