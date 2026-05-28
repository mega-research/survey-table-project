'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import {
  createCampaignAction,
  fetchCandidateIdsAction,
  previewCampaignPreflightAction,
} from '@/actions/campaign-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MailTemplate } from '@/db/schema/mail';
import type { CampaignFilterSnapshot } from '@/db/schema/schema-types';
import type { CampaignCandidateRow } from '@/lib/operations/campaigns.server';

interface Props {
  surveyId: string;
  templates: MailTemplate[];
  candidates: {
    rows: CampaignCandidateRow[];
    total: number;
    page: number;
    pageSize: number;
  };
  currentFilter: CampaignFilterSnapshot;
  initialTemplateId: string | null;
}

export function CampaignWizard({
  surveyId,
  templates,
  candidates,
  currentFilter,
  initialTemplateId,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [templateId, setTemplateId] = useState<string>(
    initialTemplateId ?? templates[0]?.id ?? '',
  );
  const [title, setTitle] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preflightSummary, setPreflightSummary] = useState<{
    valid: number;
    unsubscribed: number;
    excludedByCode: number;
    emailMissing: number;
    notFound: number;
  } | null>(null);

  // 필터 입력 (form state) — 적용 시 URL 로 push
  const [qInput, setQInput] = useState<string>(currentFilter.q ?? '');
  const [unrespondedOnly, setUnrespondedOnly] = useState<boolean>(
    currentFilter.unrespondedOnly ?? false,
  );

  const totalPages = Math.max(1, Math.ceil(candidates.total / candidates.pageSize));
  const selectedCount = selectedIds.size;
  const visibleIds = useMemo(() => candidates.rows.map((r) => r.id), [candidates.rows]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function applyFilter() {
    const next = new URLSearchParams();
    if (templateId) next.set('templateId', templateId);
    if (qInput.trim()) next.set('q', qInput.trim());
    if (unrespondedOnly) next.set('unresponded', '1');
    router.push(`?${next.toString()}`);
  }

  function changeTemplate(id: string) {
    setTemplateId(id);
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('templateId', id);
    router.push(`?${next.toString()}`);
  }

  function changePage(nextPage: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('page', String(nextPage));
    router.push(`?${next.toString()}`);
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const ns = new Set(prev);
      if (ns.has(id)) ns.delete(id);
      else ns.add(id);
      return ns;
    });
  }

  function togglePage() {
    setSelectedIds((prev) => {
      const ns = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) ns.delete(id);
      } else {
        for (const id of visibleIds) ns.add(id);
      }
      return ns;
    });
  }

  async function selectAllInFilter() {
    startTransition(async () => {
      const result = await fetchCandidateIdsAction({
        surveyId,
        filter: buildFilterSnapshot(currentFilter),
      });
      if (!result.ok || !result.data) {
        alert(result.error ?? '전체 선택 실패');
        return;
      }
      setSelectedIds(new Set(result.data.ids));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // "미응답자 재발송" 진입 시 필터 결과 전체 자동 선택 (1회만)
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (searchParams?.get('autoSelectAll') !== '1') return;
    autoSelectedRef.current = true;

    const stripFlag = () => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      next.delete('autoSelectAll');
      router.replace(`?${next.toString()}`, { scroll: false });
    };

    if (candidates.total === 0) {
      stripFlag();
      return;
    }

    startTransition(async () => {
      const result = await fetchCandidateIdsAction({
        surveyId,
        filter: buildFilterSnapshot(currentFilter),
      });
      if (result.ok && result.data) {
        setSelectedIds(new Set(result.data.ids));
      }
      stripFlag();
    });
  }, [searchParams, candidates.total, surveyId, currentFilter, router]);

  async function openConfirm() {
    if (selectedCount === 0) {
      alert('수신자를 선택하세요.');
      return;
    }
    if (!templateId) {
      alert('템플릿을 선택하세요.');
      return;
    }
    if (!title.trim()) {
      alert('단체 메일 제목을 입력하세요.');
      return;
    }
    startTransition(async () => {
      const result = await previewCampaignPreflightAction({
        surveyId,
        selectedContactIds: Array.from(selectedIds),
      });
      if (!result.ok || !result.data) {
        alert(result.error ?? 'preflight 실패');
        return;
      }
      setPreflightSummary({
        valid: result.data.validCount,
        unsubscribed: result.data.unsubscribedCount,
        excludedByCode: result.data.excludedByCodeCount,
        emailMissing: result.data.emailMissingCount,
        notFound: result.data.notFoundCount,
      });
      setConfirmOpen(true);
    });
  }

  async function submitSend() {
    startTransition(async () => {
      const result = await createCampaignAction({
        surveyId,
        mailTemplateId: templateId,
        title: title.trim(),
        contactTargetIds: Array.from(selectedIds),
        filterSnapshot: buildFilterSnapshot(currentFilter),
      });
      if (!result.ok || !result.data) {
        alert(result.error ?? '단체 메일 생성 실패');
        return;
      }
      router.push(
        `/admin/surveys/${surveyId}/operations/mail/campaigns/${result.data.campaignId}`,
      );
    });
  }

  return (
    <div className="space-y-6">
      {/* ── 1. 템플릿 + 제목 ── */}
      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold text-slate-900">캠페인 정보</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="template">메일 템플릿</Label>
            <Select value={templateId} onValueChange={changeTemplate}>
              <SelectTrigger id="template">
                <SelectValue placeholder="템플릿 선택" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">단체 메일 제목</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예) 5월 1주차 미응답자 리마인더"
              maxLength={200}
            />
          </div>
        </div>
      </Card>

      {/* ── 2. 필터 ── */}
      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold text-slate-900">수신자 필터</h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 space-y-2 min-w-[200px]">
            <Label htmlFor="q">검색 (이메일/사업자/그룹)</Label>
            <Input
              id="q"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="검색어"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="unresponded"
              checked={unrespondedOnly}
              onCheckedChange={(v) => setUnrespondedOnly(v === true)}
            />
            <Label htmlFor="unresponded" className="cursor-pointer">
              미응답자만
            </Label>
          </div>
          <Button onClick={applyFilter} variant="outline">
            필터 적용
          </Button>
        </div>

        <p className="text-xs text-slate-500">
          수신거부자(unsubscribed_at IS NOT NULL), 부정 결과코드(예: 수신거부) 마킹된 조사 대상,
          이메일 누락 조사 대상은 자동으로 제외됩니다.
        </p>
      </Card>

      {/* ── 3. 미리보기 + 선택 ── */}
      <Card className="space-y-3 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">미리보기 · 선택</h2>
            <p className="mt-1 text-sm text-slate-500">
              필터 결과 {candidates.total.toLocaleString('ko-KR')}명 — 선택{' '}
              <span className="font-semibold text-blue-600">{selectedCount.toLocaleString('ko-KR')}명</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllInFilter}
              disabled={isPending || candidates.total === 0}
            >
              필터 결과 전체 선택 ({candidates.total.toLocaleString('ko-KR')}명)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={isPending || selectedCount === 0}
            >
              선택 해제
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={togglePage}
                    aria-label="현재 페이지 전체 선택"
                  />
                </th>
                <th className="px-3 py-2">번호</th>
                <th className="px-3 py-2">이메일</th>
                <th className="px-3 py-2">그룹</th>
                <th className="px-3 py-2">응답</th>
                <th className="px-3 py-2">최근 결과코드</th>
              </tr>
            </thead>
            <tbody>
              {candidates.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                    필터에 해당하는 수신자가 없습니다.
                  </td>
                </tr>
              ) : (
                candidates.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 text-sm last:border-b-0 hover:bg-gray-50/50"
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={() => toggleRow(r.id)}
                        aria-label={`${r.emailMasked} 선택`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">#{r.resid}</td>
                    <td className="px-3 py-2 text-slate-900">{r.emailMasked}</td>
                    <td className="px-3 py-2 text-slate-600">{r.groupValue ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.respondedAt ? (
                        <span className="text-emerald-600">응답완료</span>
                      ) : (
                        <span className="text-slate-400">미응답</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {r.latestResultCode ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-slate-500">
              {candidates.page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => changePage(candidates.page - 1)}
              disabled={candidates.page <= 1}
            >
              이전
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => changePage(candidates.page + 1)}
              disabled={candidates.page >= totalPages}
            >
              다음
            </Button>
          </div>
        ) : null}
      </Card>

      {/* ── 4. 발송 ── */}
      <div className="sticky bottom-0 -mx-6 border-t border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-blue-600">{selectedCount.toLocaleString('ko-KR')}명</span>{' '}
            발송 예정
          </div>
          <Button
            onClick={openConfirm}
            disabled={isPending || selectedCount === 0 || !templateId || !title.trim()}
          >
            발송 시작
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>발송 확인</DialogTitle>
            <DialogDescription>
              선택 {selectedCount.toLocaleString('ko-KR')}명에게 발송합니다.
            </DialogDescription>
          </DialogHeader>

          {preflightSummary ? (
            <div className="space-y-1 text-sm text-slate-700">
              <div>
                실제 발송:{' '}
                <span className="font-semibold text-emerald-600">
                  {preflightSummary.valid.toLocaleString('ko-KR')}명
                </span>
              </div>
              {preflightSummary.unsubscribed > 0 ? (
                <div className="text-rose-600">
                  수신거부로 제외: {preflightSummary.unsubscribed.toLocaleString('ko-KR')}명
                </div>
              ) : null}
              {preflightSummary.excludedByCode > 0 ? (
                <div className="text-rose-600">
                  조사 대상 제외: {preflightSummary.excludedByCode.toLocaleString('ko-KR')}명
                </div>
              ) : null}
              {preflightSummary.emailMissing > 0 ? (
                <div className="text-amber-600">
                  이메일 누락으로 제외: {preflightSummary.emailMissing.toLocaleString('ko-KR')}명
                </div>
              ) : null}
              {preflightSummary.notFound > 0 ? (
                <div className="text-slate-500">
                  조사 대상 삭제로 제외: {preflightSummary.notFound.toLocaleString('ko-KR')}명
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={isPending}>
              취소
            </Button>
            <Button
              onClick={submitSend}
              disabled={isPending || (preflightSummary?.valid ?? 0) === 0}
            >
              {isPending ? '발송 중…' : '발송 시작'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildFilterSnapshot(current: CampaignFilterSnapshot): CampaignFilterSnapshot {
  // 빈 필드 제거 (DB 스냅샷 깔끔하게)
  const out: CampaignFilterSnapshot = {};
  if (current.q && current.q.trim()) {
    out.q = current.q.trim();
    out.qfield = current.qfield ?? 'all';
  }
  if (current.unrespondedOnly) out.unrespondedOnly = true;
  if (current.resultCodes && current.resultCodes.length > 0) out.resultCodes = current.resultCodes;
  if (current.groupValues && current.groupValues.length > 0) out.groupValues = current.groupValues;
  if (current.unopenedFromCampaignId) {
    out.unopenedFromCampaignId = current.unopenedFromCampaignId;
    out.unopenedAfterDays = current.unopenedAfterDays;
  }
  return out;
}
