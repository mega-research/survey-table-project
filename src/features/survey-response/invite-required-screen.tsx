'use client';

import { Lock } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export function InviteRequiredScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <Lock className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            초대 링크가 필요합니다
          </h2>
          <p className="text-gray-600">
            이 설문은 초대된 응답자만 응답할 수 있습니다. 받으신 메일/메시지의 링크로
            다시 접속해주세요.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
