'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { BillingPeriodRow } from '@/lib/operations/mail-billing.server';
import { client } from '@/shared/lib/rpc';

import { formatInt, formatKrw } from './_format';

interface Props {
  periods: BillingPeriodRow[];
}

/**
 * 요금제·결제일 시계열 관리 다이얼로그.
 *
 * - /admin/billing/mail-cost 헤더의 트리거 버튼에서 호출.
 * - 첫 진입(periods 0건) 시 자동으로 폼이 열려있어 등록 유도.
 * - 가장 최근 행만 삭제 가능. 중간 행 삭제는 과거 사이클 정합성 깨짐.
 * - 다른 필드 수정은 새 행 등록으로만 (행 UPDATE 는 백엔드에서 note 만 허용).
 */
export function BillingPeriodsDialog({ periods }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(periods.length === 0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const latestId = periods[periods.length - 1]?.id;

  const handleCreate = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const input = {
        startDate: String(formData.get('startDate') ?? ''),
        planLabel: String(formData.get('planLabel') ?? 'Pro 50K'),
        monthlyFeeKrw: Number(formData.get('monthlyFeeKrw') ?? 0),
        includedEmails: Number(formData.get('includedEmails') ?? 0),
        overagePer1kKrw: Number(formData.get('overagePer1kKrw') ?? 0),
        note: String(formData.get('note') ?? ''),
      };
      try {
        await client.mail.billing.create(input);
      } catch (e) {
        setError(e instanceof Error ? e.message : '등록 실패');
        return;
      }
      setShowForm(false);
      router.refresh();
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('이 요금제 행을 삭제하시겠어요? 가장 최근 행만 삭제 가능합니다.')) return;
    setError(null);
    startTransition(async () => {
      try {
        await client.mail.billing.deleteLatest({ id });
      } catch (e) {
        setError(e instanceof Error ? e.message : '삭제 실패');
        return;
      }
      router.refresh();
    });
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // dialog 닫을 때 transient state 초기화 — 다음 열기 때 stale error/form 잔존 방지.
      setError(null);
      setShowForm(periods.length === 0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          요금제·결제일 관리
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>요금제 · 결제일 시계열</DialogTitle>
          <DialogDescription>
            각 행은 시작일 이후 시작하는 결제 주기에 적용됩니다. 시작일의 day 가 결제일이 됩니다.
            과거 정산 정합성을 보호하기 위해 가장 최근 행만 삭제할 수 있고, 다른 필드 수정은 새 행
            등록으로만 가능합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!showForm && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="mr-1 h-4 w-4" />
                새 요금제
              </Button>
            </div>
          )}

          {showForm && (
            <form action={handleCreate} className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-700">시작일 (=결제일)</span>
                  <Input name="startDate" type="date" required disabled={pending} className="h-10" />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-700">요금제 라벨</span>
                  <Input
                    name="planLabel"
                    defaultValue="Pro 50K"
                    required
                    disabled={pending}
                    className="h-10"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-700">월 구독료 (원)</span>
                  <Input
                    name="monthlyFeeKrw"
                    type="number"
                    min={0}
                    defaultValue={28600}
                    required
                    disabled={pending}
                    className="h-10"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-700">포함량 (건)</span>
                  <Input
                    name="includedEmails"
                    type="number"
                    min={0}
                    defaultValue={50000}
                    required
                    disabled={pending}
                    className="h-10"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-700">초과 단가 (원/1,000건)</span>
                  <Input
                    name="overagePer1kKrw"
                    type="number"
                    min={0}
                    defaultValue={1290}
                    required
                    disabled={pending}
                    className="h-10"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-700">메모 (선택)</span>
                  <Input name="note" disabled={pending} className="h-10" />
                </label>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                {periods.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowForm(false)}
                    disabled={pending}
                  >
                    취소
                  </Button>
                )}
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? '등록 중...' : '등록'}
                </Button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  <th className="px-3 py-2.5">시작일</th>
                  <th className="px-3 py-2.5">결제일</th>
                  <th className="px-3 py-2.5">요금제</th>
                  <th className="px-3 py-2.5 text-right">월 구독료</th>
                  <th className="px-3 py-2.5 text-right">포함량</th>
                  <th className="px-3 py-2.5 text-right">초과 단가</th>
                  <th className="px-3 py-2.5">메모</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {periods.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-500">
                      등록된 요금제가 없습니다.
                    </td>
                  </tr>
                ) : (
                  periods.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 last:border-b-0">
                      <td className="px-3 py-2.5 tabular-nums text-gray-900">{p.startDate}</td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-700">매달 {p.billingDayOfMonth}일</td>
                      <td className="px-3 py-2.5 text-gray-700">{p.planLabel}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                        {formatKrw(p.monthlyFeeKrw)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                        {formatInt(p.includedEmails)}건
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                        {formatKrw(p.overagePer1kKrw)}/1K
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2.5 text-gray-500">{p.note ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {p.id === latestId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(p.id)}
                            disabled={pending}
                            title="삭제 (가장 최근 행만)"
                          >
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
