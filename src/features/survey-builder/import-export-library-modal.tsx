'use client';

import { useEffect, useRef, useState } from 'react';

import { AlertCircle, Check, Copy, Download, FileJson, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useExportLibrary, useImportLibrary, useSavedQuestions } from '@/features/survey-builder/queries/use-library';

interface ImportExportLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportExportLibraryModal({ open, onOpenChange }: ImportExportLibraryModalProps) {
  // TanStack Query 훅 사용
  const { data: savedQuestions = [] } = useSavedQuestions();
  const exportLibraryMutation = useExportLibrary();
  const importLibraryMutation = useImportLibrary();

  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exportData, setExportData] = useState('');
  const [importData, setImportData] = useState('');
  const [importError, setImportError] = useState('');
  const [copied, setCopied] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (importTimerRef.current) clearTimeout(importTimerRef.current);
    };
  }, []);

  const handleExport = async () => {
    try {
      const data = await exportLibraryMutation.mutateAsync();
      setExportData(data);
    } catch (error) {
      console.error('Failed to export:', error);
    }
  };

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(exportData);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `question-library-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    setImportError('');
    setImportSuccess(false);

    if (!importData.trim()) {
      setImportError('가져올 데이터를 입력해주세요.');
      return;
    }

    try {
      await importLibraryMutation.mutateAsync(importData);
      setImportSuccess(true);
      setImportData('');
      if (importTimerRef.current) clearTimeout(importTimerRef.current);
      importTimerRef.current = setTimeout(() => {
        setImportSuccess(false);
        onOpenChange(false);
      }, 1500);
    } catch {
      setImportError('유효하지 않은 데이터입니다.');
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportData(content);
    };
    reader.onerror = () => {
      setImportError('파일을 읽는 중 오류가 발생했습니다.');
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-blue-600" />
            보관함 내보내기 / 가져오기
          </DialogTitle>
          <DialogDescription>
            보관함의 질문을 JSON 파일로 내보내거나 가져올 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'export' | 'import')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="export" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              내보내기
            </TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              가져오기
            </TabsTrigger>
          </TabsList>

          <TabsContent value="export" className="mt-4 space-y-4">
            <div className="rounded-lg border bg-gray-50 p-3">
              <p className="text-sm text-gray-600">
                현재 보관함에 저장된 <strong>{savedQuestions.length}개</strong>의 질문을 내보냅니다.
              </p>
            </div>

            <Textarea
              value={exportData}
              readOnly
              rows={8}
              placeholder="내보내기 버튼을 클릭하면 JSON 데이터가 표시됩니다."
              className="font-mono text-xs"
            />

            <div className="flex gap-2">
              <Button onClick={handleExport} variant="outline" className="flex-1">
                <FileJson className="mr-2 h-4 w-4" />
                JSON 생성
              </Button>
              {exportData && (
                <>
                  <Button onClick={handleCopyToClipboard} variant="outline">
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button onClick={handleDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    다운로드
                  </Button>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="import" className="mt-4 space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm text-blue-700">
                JSON 파일을 업로드하거나 JSON 텍스트를 직접 붙여넣기 하세요.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />

            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              <Upload className="mr-2 h-4 w-4" />
              JSON 파일 선택
            </Button>

            <Textarea
              value={importData}
              onChange={(e) => {
                setImportData(e.target.value);
                setImportError('');
              }}
              rows={8}
              placeholder="JSON 데이터를 붙여넣기 하세요..."
              className="font-mono text-xs"
            />

            {importError && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                {importError}
              </div>
            )}

            {importSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="h-4 w-4" />
                성공적으로 가져왔습니다!
              </div>
            )}

            <Button onClick={handleImport} disabled={!importData.trim()} className="w-full">
              <Upload className="mr-2 h-4 w-4" />
              가져오기
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
