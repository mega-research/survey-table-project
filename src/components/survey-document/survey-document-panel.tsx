'use client';

import { useMemo, useRef, useState } from 'react';

import { FileText, MapPin, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  useCreateSurveyAnchor,
  useRemoveSurveyAnchor,
  useSurveyAnchors,
} from '@/hooks/queries/use-survey-anchors';
import {
  useAttachSurveyDocument,
  useRemoveSurveyDocument,
  useSurveyDocuments,
} from '@/hooks/queries/use-survey-documents';
import { buildAnchorOutline, resolveAnchorOwnerId } from '@/lib/survey-document/anchor-outline';
import type { NormRect } from '@/lib/survey-document/anchor-geometry';
import { cn } from '@/lib/utils';
import { useSurveyBuilderStore } from '@/stores/survey-store';

import { AnchorCanvas, type CanvasRegion } from './anchor-canvas';

/**
 * 빌더의 조사표 화면 — 조사표를 붙이고, 그 위에 영역을 지정한다.
 *
 * **생성과 영역 지정을 가른다.** 그룹·질문은 질문 편집 탭에서 이름만으로 먼저
 * 만들어지고, 여기서는 이미 있는 대상을 골라 영역만 붙인다. 평소 드래그는
 * 아무것도 만들지 않는다 — 드래그가 곧 생성이던 데모 첫판이 오조작으로 뒤집혔다.
 *
 * 발행 뒤에도 파일을 교체할 수 있고 **교체 가드를 두지 않는다** (ADR 0020).
 */
interface Props {
  surveyId: string;
}

type DrawTarget = { kind: 'group' | 'question'; id: string; label: string };

export function SurveyDocumentPanel({ surveyId }: Props) {
  const { data: documents = [], isLoading } = useSurveyDocuments(surveyId);
  const { data: anchors = [] } = useSurveyAnchors(surveyId);
  const attach = useAttachSurveyDocument(surveyId);
  const removeDocument = useRemoveSurveyDocument(surveyId);
  const createAnchor = useCreateSurveyAnchor(surveyId);
  const removeAnchor = useRemoveSurveyAnchor(surveyId);

  const { groups, questions } = useSurveyBuilderStore(
    useShallow((s) => ({
      groups: s.currentSurvey.groups ?? [],
      questions: s.currentSurvey.questions,
    })),
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [drawTarget, setDrawTarget] = useState<DrawTarget | null>(null);
  const [selected, setSelected] = useState<DrawTarget | null>(null);

  // 전역 document 를 가리지 않도록 이름을 구분한다 (클라이언트 컴포넌트)
  const surveyDocument = documents[0] ?? null;

  const outline = useMemo(
    () =>
      buildAnchorOutline(
        groups.map((g) => ({ id: g.id, name: g.name, order: g.order })),
        questions.map((q) => ({
          id: q.id,
          groupId: q.groupId ?? null,
          order: q.order,
          questionCode: q.questionCode ?? null,
          title: q.title,
        })),
      ),
    [groups, questions],
  );

  const labelOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of outline) {
      if (section.groupId) map.set(section.groupId, section.label);
      for (const question of section.questions) map.set(question.id, question.label);
    }
    return map;
  }, [outline]);

  const anchorsByOwner = useMemo(() => {
    const map = new Map<string, typeof anchors>();
    for (const anchor of anchors) {
      const list = map.get(anchor.ownerId);
      if (list) list.push(anchor);
      else map.set(anchor.ownerId, [anchor]);
    }
    return map;
  }, [anchors]);

  const regions: CanvasRegion[] = useMemo(
    () =>
      anchors.map((anchor) => ({
        id: anchor.id,
        ownerId: anchor.ownerId,
        label: labelOf.get(anchor.ownerId) ?? '(삭제된 대상)',
        kind: anchor.ownerKind === 'group' ? 'group' : 'question',
        page: anchor.page,
        x: anchor.x,
        y: anchor.y,
        w: anchor.w,
        h: anchor.h,
      })),
    [anchors, labelOf],
  );

  const activeOwnerId = selected
    ? resolveAnchorOwnerId(
        selected.kind === 'group'
          ? { kind: 'group', id: selected.id }
          : {
              kind: 'question',
              id: selected.id,
              groupId: questions.find((q) => q.id === selected.id)?.groupId ?? null,
            },
        (ownerId) => (anchorsByOwner.get(ownerId)?.length ?? 0) > 0,
      )
    : null;

  const pickFile = (replaceId: string | null) => {
    setReplaceTargetId(replaceId);
    fileRef.current?.click();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await attach.mutateAsync({
        file,
        ...(replaceTargetId ? { replaceDocumentId: replaceTargetId } : {}),
      });
      setPage(1);
      toast.success(replaceTargetId ? '조사표를 교체했습니다.' : '조사표를 붙였습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '조사표 등록에 실패했습니다.');
    } finally {
      setReplaceTargetId(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemoveDocument = async (documentId: string) => {
    if (
      !window.confirm(
        '조사표를 뗄까요? 지정한 영역도 함께 사라지고, 파일은 7일 뒤 정리됩니다.',
      )
    ) {
      return;
    }
    try {
      await removeDocument.mutateAsync(documentId);
      toast.success('조사표를 뗐습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '조사표 삭제에 실패했습니다.');
    }
  };

  const handleDraw = async (rect: NormRect) => {
    if (!surveyDocument || !drawTarget) return;
    try {
      await createAnchor.mutateAsync({
        documentId: surveyDocument.id,
        ownerKind: drawTarget.kind,
        ownerId: drawTarget.id,
        rect,
      });
      setSelected(drawTarget);
      setDrawTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '영역을 저장하지 못했습니다.');
    }
  };

  const startDrawing = (target: DrawTarget) => {
    setSelected(target);
    setDrawTarget(target);
    const first = anchorsByOwner.get(target.id)?.[0];
    if (first) setPage(first.page);
  };

  const jumpTo = (target: DrawTarget) => {
    setSelected(target);
    const ownerId = resolveAnchorOwnerId(
      target.kind === 'group'
        ? { kind: 'group', id: target.id }
        : {
            kind: 'question',
            id: target.id,
            groupId: questions.find((q) => q.id === target.id)?.groupId ?? null,
          },
      (id) => (anchorsByOwner.get(id)?.length ?? 0) > 0,
    );
    const first = ownerId ? anchorsByOwner.get(ownerId)?.[0] : undefined;
    if (first) setPage(first.page);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">
              {surveyDocument ? surveyDocument.filename : '조사표'}
            </p>
            <p className="text-xs text-gray-500">
              {surveyDocument
                ? `${surveyDocument.pageCount}쪽 · 영역 ${anchors.length}개`
                : '판단 대상이 될 PDF 를 올립니다'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={attach.isPending}
            onClick={() => pickFile(surveyDocument?.id ?? null)}
          >
            <Upload className="mr-1 h-3 w-3" />
            {attach.isPending ? '올리는 중…' : surveyDocument ? '교체' : '올리기'}
          </Button>
          {surveyDocument && (
            <Button
              variant="ghost"
              size="sm"
              disabled={removeDocument.isPending}
              onClick={() => void handleRemoveDocument(surveyDocument.id)}
              aria-label="조사표 떼기"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-gray-500">
          조사표를 불러오는 중…
        </div>
      ) : !surveyDocument ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <FileText className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm text-gray-600">아직 조사표가 없습니다.</p>
            <p className="mt-1 text-xs text-gray-500">
              지난 회차 조사표 PDF 를 올리면 여기서 쪽을 넘겨 보고 영역을 지정할 수 있습니다.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <AnchorCanvas
              url={surveyDocument.url}
              pageCount={surveyDocument.pageCount}
              page={page}
              onPageChange={setPage}
              regions={regions}
              activeOwnerId={activeOwnerId}
              drawingFor={drawTarget ? { label: drawTarget.label } : null}
              onDraw={(rect) => void handleDraw(rect)}
              onCancelDraw={() => setDrawTarget(null)}
              onRegionClick={(region) => {
                setPage(region.page);
                setSelected({
                  kind: region.kind === 'group' ? 'group' : 'question',
                  id: region.ownerId,
                  label: region.label,
                });
              }}
            />
          </div>

          <div className="w-[280px] shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500">
              대상을 골라 <b>영역 지정</b>을 누르고 조사표 위를 드래그하세요.
              <br />
              문항에 영역을 주지 않으면 소속 그룹의 영역으로 떨어집니다.
            </div>
            {outline.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-500">
                질문 편집 탭에서 그룹과 질문을 먼저 만드세요.
              </p>
            )}
            {outline.map((section) => (
              <div key={section.groupId ?? '__ungrouped__'} className="border-b border-gray-100">
                {section.groupId ? (
                  <TargetRow
                    label={section.label}
                    isGroup
                    selected={selected?.id === section.groupId}
                    anchorPages={(anchorsByOwner.get(section.groupId) ?? []).map((a) => a.page)}
                    anchorIds={(anchorsByOwner.get(section.groupId) ?? []).map((a) => a.id)}
                    onSelect={() =>
                      jumpTo({ kind: 'group', id: section.groupId!, label: section.label })
                    }
                    onDraw={() =>
                      startDrawing({ kind: 'group', id: section.groupId!, label: section.label })
                    }
                    onRemoveAnchor={(id) => void removeAnchor.mutateAsync(id)}
                  />
                ) : (
                  <div className="px-3 py-2 text-xs font-medium text-gray-500">{section.label}</div>
                )}
                {section.questions.map((question) => (
                  <TargetRow
                    key={question.id}
                    label={question.label}
                    isGroup={false}
                    selected={selected?.id === question.id}
                    anchorPages={(anchorsByOwner.get(question.id) ?? []).map((a) => a.page)}
                    anchorIds={(anchorsByOwner.get(question.id) ?? []).map((a) => a.id)}
                    onSelect={() =>
                      jumpTo({ kind: 'question', id: question.id, label: question.label })
                    }
                    onDraw={() =>
                      startDrawing({ kind: 'question', id: question.id, label: question.label })
                    }
                    onRemoveAnchor={(id) => void removeAnchor.mutateAsync(id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TargetRowProps {
  label: string;
  isGroup: boolean;
  selected: boolean;
  anchorPages: number[];
  anchorIds: string[];
  onSelect: () => void;
  onDraw: () => void;
  onRemoveAnchor: (anchorId: string) => void;
}

function TargetRow({
  label,
  isGroup,
  selected,
  anchorPages,
  anchorIds,
  onSelect,
  onDraw,
  onRemoveAnchor,
}: TargetRowProps) {
  return (
    <div
      className={cn(
        'group flex items-start gap-1 px-3 py-1.5',
        isGroup ? 'bg-gray-50' : 'pl-6',
        selected && 'bg-blue-50',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'min-w-0 flex-1 truncate text-left text-xs',
          isGroup ? 'font-semibold text-gray-800' : 'text-gray-700',
        )}
        title={label}
      >
        {label}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {anchorIds.map((anchorId, index) => (
          <button
            key={anchorId}
            type="button"
            onClick={() => onRemoveAnchor(anchorId)}
            title={`${anchorPages[index]}쪽 영역 지우기`}
            className={cn(
              'flex items-center gap-0.5 rounded px-1 text-[10px] tabular-nums',
              isGroup
                ? 'bg-blue-100 text-blue-700 hover:bg-red-100 hover:text-red-700'
                : 'bg-amber-100 text-amber-700 hover:bg-red-100 hover:text-red-700',
            )}
          >
            {anchorPages[index]}
            <X className="h-2.5 w-2.5" />
          </button>
        ))}
        <button
          type="button"
          onClick={onDraw}
          title="영역 지정"
          className="rounded p-0.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-700"
        >
          <MapPin className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
