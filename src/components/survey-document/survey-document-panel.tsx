'use client';

import { useRef, useState } from 'react';

import { FileText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  useAttachSurveyDocument,
  useRemoveSurveyDocument,
  useSurveyDocuments,
} from '@/hooks/queries/use-survey-documents';

import { PdfPageView } from './pdf-page-view';

/**
 * 빌더의 조사표 패널 — 조사표를 붙이고, 페이지 단위로 넘겨 본다.
 *
 * 발행 뒤에도 파일을 교체할 수 있고 **교체 가드를 두지 않는다** (ADR 0020).
 * 쪽 수가 줄면 얼린 앵커가 없는 쪽을 가리킬 수 있는데, 그 판단은 기획자 몫이다.
 * 대신 교체 버튼 옆에 무슨 일이 벌어지는지 적어 둔다.
 */
interface Props {
  surveyId: string;
}

export function SurveyDocumentPanel({ surveyId }: Props) {
  const { data: documents = [], isLoading } = useSurveyDocuments(surveyId);
  const attach = useAttachSurveyDocument(surveyId);
  const remove = useRemoveSurveyDocument(surveyId);

  const fileRef = useRef<HTMLInputElement>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const document = documents[0] ?? null;

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

  const handleRemove = async (documentId: string) => {
    if (!window.confirm('조사표를 뗄까요? 파일은 7일 뒤 정리되고 그 전에는 되돌릴 수 있습니다.')) {
      return;
    }
    try {
      await remove.mutateAsync(documentId);
      toast.success('조사표를 뗐습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '조사표 삭제에 실패했습니다.');
    }
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
              {document ? document.filename : '조사표'}
            </p>
            <p className="text-xs text-gray-500">
              {document ? `${document.pageCount}쪽` : '판단 대상이 될 PDF 를 올립니다'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={attach.isPending}
            onClick={() => pickFile(document?.id ?? null)}
          >
            <Upload className="mr-1 h-3 w-3" />
            {attach.isPending ? '올리는 중…' : document ? '교체' : '올리기'}
          </Button>
          {document && (
            <Button
              variant="ghost"
              size="sm"
              disabled={remove.isPending}
              onClick={() => void handleRemove(document.id)}
              aria-label="조사표 떼기"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="grid h-full place-items-center text-sm text-gray-500">
            조사표를 불러오는 중…
          </div>
        ) : document ? (
          <PdfPageView
            url={document.url}
            pageCount={document.pageCount}
            page={page}
            onPageChange={setPage}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <FileText className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-600">아직 조사표가 없습니다.</p>
              <p className="mt-1 text-xs text-gray-500">
                지난 회차 조사표 PDF 를 올리면 여기서 쪽을 넘겨 볼 수 있습니다.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
