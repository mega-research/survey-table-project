'use client';

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  FileText,
  Library,
  Plus,
  Rocket,
  Save,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TestModeControl } from '@/features/operations/test-mode-control';
import { CompletionMessageModal } from '@/features/survey-builder/completion-message-modal';
import { useBuilderScroll } from '@/features/survey-builder/hooks/use-builder-scroll';
import { useEnsureSurveyInDb } from '@/features/survey-builder/hooks/use-ensure-survey-in-db';
import { ImportExportLibraryModal } from '@/features/survey-builder/import-export-library-modal';
import { publishConfirmMessage } from '@/features/survey-builder/lib/publish-confirm-message';
import { useSaveSurvey } from '@/features/survey-builder/queries/use-surveys';
import { QuestionLibraryPanel } from '@/features/survey-builder/question-library-panel';
import { SortableQuestionList } from '@/features/survey-builder/question-list/sortable-question-list';
import { QuestionTypePalette } from '@/features/survey-builder/question-type-palette';
import { ResponseHeaderSettingsModal } from '@/features/survey-builder/response-header-settings-modal';
import { SaveQuestionModal } from '@/features/survey-builder/save-question-modal';
import { SaveSuccessModal } from '@/features/survey-builder/save-success-modal';
import { ScrollEdgeButtons } from '@/features/survey-builder/scroll-edge-buttons';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { useSurveyUIStore } from '@/features/survey-builder/stores/ui-store';
import { SurveyDocumentPanel } from '@/features/survey-builder/survey-document/survey-document-panel';
import { SurveySettingsPanel } from '@/features/survey-builder/survey-settings-panel';
import type { VarNameIssue } from '@/lib/spss/variable-name-guard';
import { generateSlugFromTitle, validateSlug } from '@/lib/survey-url';
import { generateId } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';
import { useErrorDialogStore } from '@/stores/error-dialog-store';
import { Question } from '@/types/survey';

/**
 * 새 설문 만들기 — 화면은 편집 화면(`[id]/edit`)과 한 벌이다.
 *
 * 다른 것은 두 가지다. ① 불러올 설문이 없다 — 스토어를 새 설문으로 비우고 시작하며, 편집 화면의
 * 설문 조회·변수 카탈로그 조회가 없다(명단이 없는 설문이라 카탈로그는 빈 목록이다). ② 저장이
 * 생성부터다 — DB 에 아직 없으면 소유 팀을 정하는 입구(ensure)로 먼저 만들고 전체 저장으로
 * 내용을 싣는다. 편집 화면의 diff 저장은 DB 에 있는 설문의 변경분을 전제한다.
 *
 * DB 행이 있어야 동작하는 자리 — 테스트 모드 토글·조사표 — 는 첫 저장 뒤에 열린다. 배포는
 * 저장을 먼저 하므로 저장 전에도 누를 수 있다.
 */
export default function CreateSurveyPage() {
  // 액션 (안정적 참조)
  const {
    updateSurveyTitle,
    addQuestion,
    addPreparedQuestion,
    updateSurveySlug,
    markPublished,
    markClean,
    resetSurvey,
    setCreateTeamId,
  } = useSurveyBuilderStore(
    useShallow((s) => ({
      updateSurveyTitle: s.updateSurveyTitle,
      addQuestion: s.addQuestion,
      addPreparedQuestion: s.addPreparedQuestion,
      updateSurveySlug: s.updateSurveySlug,
      markPublished: s.markPublished,
      markClean: s.markClean,
      resetSurvey: s.resetSurvey,
      setCreateTeamId: s.setCreateTeamId,
    })),
  );

  // Primitive 상태 (값 비교)
  const { surveyId, isModifiedSincePublish, isSavedToDb } = useSurveyBuilderStore(
    useShallow((s) => ({
      surveyId: s.currentSurvey.id,
      isModifiedSincePublish: s.isModifiedSincePublish,
      isSavedToDb: s.isSavedToDb,
    })),
  );
  // 헤더 모달이 updateSurveyTitle로 직접 바꾸는 store.title — 툴바 로컬 titleInput 동기화용 구독
  const storeTitle = useSurveyBuilderStore((s) => s.currentSurvey.title);

  // 질문/그룹 배열은 SortableQuestionList 내부에서 직접 구독
  // 페이지에서는 길이만 구독하여 리렌더 최소화
  const questionCount = useSurveyBuilderStore((s) => s.currentSurvey.questions.length);
  const groupCount = useSurveyBuilderStore((s) => (s.currentSurvey.groups || []).length);
  const isDirty = useSurveyBuilderStore((s) => s.isDirty);

  const { selectedQuestionId, selectQuestion, setVariableCatalog } = useSurveyUIStore(
    useShallow((s) => ({
      selectedQuestionId: s.selectedQuestionId,
      selectQuestion: s.selectQuestion,
      setVariableCatalog: s.setVariableCatalog,
    })),
  );
  const {
    showScrollButtons,
    questionNumberInput,
    setQuestionNumberInput,
    scrollToTop,
    scrollToBottom,
    handleQuestionNumberKeyPress,
  } = useBuilderScroll(selectQuestion);
  const { mutateAsync: saveSurveyWithDetails } = useSaveSurvey();
  const ensureSurvey = useEnsureSurveyInDb();
  // 시스템 전체 보기에서 팀을 골라 들어온 경우 — 작업 범위 대신 이 팀 소유로 만든다.
  const createTeamParam = useSearchParams().get('team');

  const [titleInput, setTitleInput] = useState('새 설문조사');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [slugInput, setSlugInput] = useState('');
  const [slugError, setSlugError] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);

  // 라이브러리 관련 상태
  const [leftSidebarTab, setLeftSidebarTab] = useState<'types' | 'library'>('types');
  const [showSaveQuestionModal, setShowSaveQuestionModal] = useState(false);
  const [questionToSave, setQuestionToSave] = useState<Question | null>(null);
  const [showImportExportModal, setShowImportExportModal] = useState(false);
  const publishMutation = useMutation({
    mutationFn: async () => {
      // 배포 전 저장 — 아직 DB 에 없으면 여기서 만들어진다.
      await persistSurvey();
      return client.surveyBuilder.publish.publish({
        surveyId: useSurveyBuilderStore.getState().currentSurvey.id,
      });
    },
    onSuccess: (version) => {
      markPublished();
      toast.success(`설문이 배포되었습니다. 버전 ${version.versionNumber}`);
    },
    onError: (error) => {
      const issues = (error as { data?: { issues?: VarNameIssue[] } })?.data?.issues;
      if (issues && issues.length > 0) {
        useErrorDialogStore.getState().show({
          title: 'SPSS 변수명 오류로 배포가 중단되었습니다',
          description: '빌더에서 해당 변수명을 수정한 뒤 다시 배포하세요.',
          issues,
        });
      } else {
        toast.error(
          `배포 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        );
      }
    },
  });
  const isPublishing = publishMutation.isPending;
  // 가운데 열 탭 — 질문 편집 / 조사표(수요조사용 PDF)
  const [centerTab, setCenterTab] = useState<'edit' | 'document'>('edit');

  // 새 설문으로 시작 — 앞서 연 설문의 변수 카탈로그가 남아 있으면 프리필 토큰 목록에 남의
  // 명단 열이 보이므로 함께 비운다.
  useEffect(() => {
    resetSurvey();
    setCreateTeamId(createTeamParam);
    setVariableCatalog([]);
  }, [resetSurvey, setCreateTeamId, setVariableCatalog, createTeamParam]);

  // 헤더 모달이 updateSurveyTitle로 store.title을 직접 바꿀 수 있어(설문 헤더 설정 등),
  // 툴바 로컬 titleInput이 stale해지지 않도록 store 값으로 동기화한다.
  // 단, 툴바 입력이 포커스 상태(한글 IME 조합 포함)일 때 되돌리면 조합이 깨지므로 포커스 가드를 둔다.
  useEffect(() => {
    if (document.activeElement !== titleInputRef.current) {
      setTitleInput(storeTitle);
    }
  }, [storeTitle]);

  // 저장되지 않은 변경이 있을 때 페이지 이탈 경고
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // 슬러그 입력 핸들러 (입력값만 업데이트, 서버 호출은 제거)
  const handleSlugChange = (value: string) => {
    setSlugInput(value);
    updateSurveySlug(value); // 로컬 스토어 업데이트

    // 빈 값이면 즉시 에러 초기화
    if (!value) {
      setSlugError('');
      return;
    }

    // 클라이언트 사이드 유효성 검사만 즉시 수행
    const validation = validateSlug(value);
    if (!validation.isValid) {
      setSlugError(validation.error || '');
      return;
    }

    // 서버 호출은 useEffect의 debounce가 담당
  };

  // 슬러그 중복 검사 (Debounce 적용 - 500ms 지연)
  useEffect(() => {
    // 빈 값이면 검사하지 않음 — 에러 초기화는 입력 지점(handleSlugChange/설문 전환 동기화)이 담당
    if (!slugInput) {
      return;
    }

    const validation = validateSlug(slugInput);
    if (!validation.isValid) {
      // 클라이언트 사이드 검사는 이미 handleSlugChange에서 처리됨
      return;
    }

    let cancelled = false;

    // 500ms 후에 서버 검사 수행
    const excludePatch = surveyId ? { excludeSurveyId: surveyId } : {};
    const timer = setTimeout(async () => {
      try {
        const isAvailable = await client.surveyBuilder.read.slugAvailable({
          slug: slugInput,
          ...excludePatch,
        });
        if (cancelled) return;
        if (!isAvailable) {
          setSlugError('이미 사용 중인 URL입니다. 다른 URL을 입력해주세요.');
        } else {
          setSlugError('');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('슬러그 중복 검사 실패:', error);
        }
      }
    }, 500); // 0.5초 대기

    // cleanup: 타이핑이 계속되면 이전 타이머 취소 + 진행 중인 async 무시
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slugInput, surveyId]);

  // 제목에서 자동 슬러그 생성 (생성된 슬러그를 반환해 저장 페이로드에 즉시 반영 가능)
  const handleAutoGenerateSlug = async (): Promise<string | undefined> => {
    const autoSlug = generateSlugFromTitle(titleInput);
    if (autoSlug) {
      // 중복 시 접미사 추가 - 서버 액션으로 확인
      let finalSlug = autoSlug;
      let counter = 1;
      let isAvailable = await client.surveyBuilder.read.slugAvailable({
        slug: finalSlug,
        ...(surveyId ? { excludeSurveyId: surveyId } : {}),
      });
      while (!isAvailable) {
        finalSlug = `${autoSlug}-${counter}`;
        counter++;
        isAvailable = await client.surveyBuilder.read.slugAvailable({
          slug: finalSlug,
          ...(surveyId ? { excludeSurveyId: surveyId } : {}),
        });
      }
      setSlugInput(finalSlug);
      updateSurveySlug(finalSlug);
      setSlugError('');
      return finalSlug;
    }
    return undefined;
  };

  // 설문 저장 — 처음이면 생성부터, 그다음 전체 저장.
  const persistSurvey = async () => {
    const latest = useSurveyBuilderStore.getState().currentSurvey;
    let surveyToSave = latest.id ? latest : { ...latest, id: generateId() };

    // 공개 설문인데 슬러그가 없으면 자동 생성
    // handleAutoGenerateSlug는 store/state에만 기록되므로 반환값을 페이로드에 직접 반영해야 한다
    if (surveyToSave.settings.isPublic && !slugInput) {
      const generatedSlug = await handleAutoGenerateSlug();
      if (generatedSlug) {
        surveyToSave = { ...surveyToSave, slug: generatedSlug };
      }
    }

    // 아직 DB 에 없으면 생성부터 한다 — 생성은 소유 팀을 정하는 입구(ensure)가 맡고, 전체 저장은
    // 갱신으로 지나간다. 전체 저장의 생성 모드는 작업 범위 쿠키만 보므로 고른 팀을 모른다.
    if (!useSurveyBuilderStore.getState().isSavedToDb && latest.id) {
      await ensureSurvey();
    }
    await saveSurveyWithDetails(surveyToSave);
    // 전체 저장은 스토어의 변경 기록을 쓰지 않는다 — 비우지 않으면 이탈 경고가 저장 뒤에도 뜬다.
    markClean();
  };

  const handleSaveSurvey = async () => {
    try {
      await persistSurvey();
      setShowSaveModal(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('이미 사용 중인 URL') ||
        message.includes('slug_unique') ||
        message.includes('23505')
      ) {
        setSlugError('이미 사용 중인 URL입니다. 다른 URL을 입력해주세요.');
      } else {
        toast.error('설문 저장에 실패했습니다. 다시 시도해주세요.');
      }
    }
  };

  // 설문 배포
  const handlePublishSurvey = async () => {
    if (!surveyId) return;

    // 배포 안내 — 진행중·이탈 응답이 새 버전으로 이어짐(ADR-0014)과, 종료된 설문이면 배포가
    // 종료를 푼다는 것(ADR-0030)을 고지한다.
    // 조회 실패는 배포를 막지 않는다. 그때는 종료 경고도 빠지는데, 막으면 이 한 번의 조회
    // 장애가 배포 전체를 세운다 — 안내는 부가 정보이고 배포는 본업이다.
    let preflight = { migratableCount: 0, isClosed: false };
    try {
      const result = await client.surveyBuilder.publish.migratableCount({ surveyId });
      preflight = { migratableCount: result.count, isClosed: result.isClosed };
    } catch {
      // 조회 실패 무시 — 기본 문구로 진행
    }

    const confirmed = window.confirm(publishConfirmMessage(preflight));
    if (!confirmed) return;

    publishMutation.mutate();
  };

  // 질문 라이브러리에 저장
  const handleSaveToLibrary = (question: Question) => {
    setQuestionToSave(question);
    setShowSaveQuestionModal(true);
  };

  // 라이브러리에서 질문 추가
  const handleAddFromLibrary = (question: Question) => {
    addPreparedQuestion(question);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/surveys">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                목록으로
              </Button>
            </Link>
            <div className="h-6 w-px bg-gray-300" />
            <Input
              ref={titleInputRef}
              value={titleInput}
              onChange={(e) => {
                setTitleInput(e.target.value);
                updateSurveyTitle(e.target.value);
              }}
              className="border-none bg-transparent px-2 text-lg font-medium focus:border focus:border-blue-200 focus:bg-white"
              placeholder="설문 제목을 입력하세요"
            />
          </div>

          <div className="flex items-center space-x-3">
            {/* 운영 콘솔과 동일한 DB 테스트 모드 토글 — DB 행이 있어야 하므로 첫 저장 뒤에 선다 */}
            {isSavedToDb && surveyId && <TestModeControl surveyId={surveyId} />}
            <Button variant="outline" size="sm" onClick={handleSaveSurvey}>
              <Save className="mr-2 h-4 w-4" />
              저장
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePublishSurvey}
              disabled={isPublishing}
              className="border-blue-300 text-blue-600 hover:bg-blue-50"
            >
              <Rocket className="mr-2 h-4 w-4" />
              {isPublishing ? '배포 중...' : '배포'}
            </Button>
            <Button size="sm">
              <Share2 className="mr-2 h-4 w-4" />
              공유
            </Button>
          </div>
        </div>
      </nav>

      {/* 배포 후 수정 경고 배너 */}
      {isModifiedSincePublish && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>배포된 설문이 수정되었습니다. 변경사항을 반영하려면 재배포가 필요합니다.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePublishSurvey}
            disabled={isPublishing}
            className="border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            <Rocket className="mr-2 h-3 w-3" />
            {isPublishing ? '배포 중...' : '재배포'}
          </Button>
        </div>
      )}

      {/* Main Content */}
      <div className="w-full p-6">
        <div className="grid grid-cols-[280px_1fr_280px] gap-6">
          {/* Left Sidebar - Question Types & Library */}
          <div className="flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <Tabs
              value={leftSidebarTab}
              onValueChange={(v) => setLeftSidebarTab(v as 'types' | 'library')}
              className="flex h-full flex-col"
            >
              <TabsList className="mb-0 grid w-full grid-cols-2 p-1">
                <TabsTrigger value="types" className="text-xs">
                  <Plus className="mr-1 h-3 w-3" />
                  질문 생성
                </TabsTrigger>
                <TabsTrigger value="library" className="text-xs">
                  <Library className="mr-1 h-3 w-3" />
                  보관함
                </TabsTrigger>
              </TabsList>

              <TabsContent value="types" className="m-0 flex-1 overflow-y-auto p-4 pt-2">
                <div className="space-y-3">
                  <ResponseHeaderSettingsModal />
                  <QuestionTypePalette onSelect={addQuestion} />
                  <CompletionMessageModal />
                </div>

                <div className="mt-6 border-t border-gray-200 pt-6">
                  <h4 className="mb-3 text-sm font-medium text-gray-700">설문 정보</h4>
                  <div className="space-y-1 text-xs text-gray-500">
                    <p>그룹 수: {groupCount}개</p>
                    <p>질문 수: {questionCount}개</p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent
                value="library"
                className="m-0 flex flex-1 flex-col overflow-hidden p-4 pt-2"
              >
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <QuestionLibraryPanel onAddQuestion={handleAddFromLibrary} />
                </div>

                {/* 내보내기/가져오기 버튼 */}
                <div className="mt-4 flex-shrink-0 border-t border-gray-200 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowImportExportModal(true)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    내보내기 / 가져오기
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Center - Survey Preview/Edit + 조사표 */}
          <div className="flex h-[calc(100vh-140px)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <Tabs
              value={centerTab}
              onValueChange={(v) => setCenterTab(v as 'edit' | 'document')}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="mx-6 mt-4 grid w-[240px] grid-cols-2">
                <TabsTrigger value="edit" className="text-xs">
                  질문 편집
                </TabsTrigger>
                <TabsTrigger value="document" className="text-xs">
                  <FileText className="mr-1 h-3 w-3" />
                  조사표
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <div className="border-b border-gray-200 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-lg font-semibold text-gray-900">설문 편집</h3>
                      {questionCount > 0 && (
                        <div className="flex items-center space-x-2">
                          <Input
                            type="number"
                            min="1"
                            max={questionCount}
                            value={questionNumberInput}
                            onChange={(e) => setQuestionNumberInput(e.target.value)}
                            onKeyPress={handleQuestionNumberKeyPress}
                            placeholder="질문 번호"
                            className="h-8 w-24 text-sm"
                          />
                          <span className="text-xs text-gray-500">/ {questionCount}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">{questionCount}개 질문</div>
                  </div>
                </div>

                <div className="p-6">
                  {questionCount === 0 ? (
                    <div className="py-16 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                        <Plus className="h-8 w-8 text-gray-400" />
                      </div>
                      <h3 className="mb-2 text-lg font-medium text-gray-900">
                        질문을 추가해보세요
                      </h3>
                      <p className="mb-6 text-gray-500">
                        왼쪽에서 원하는 질문 유형을 클릭하거나 보관함에서 불러올 수 있습니다.
                      </p>
                      <div className="flex justify-center gap-2">
                        <Button
                          onClick={() => {
                            addQuestion('text');
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" />첫 번째 질문 추가
                        </Button>
                        <Button variant="outline" onClick={() => setLeftSidebarTab('library')}>
                          <Library className="mr-2 h-4 w-4" />
                          보관함에서 불러오기
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <SortableQuestionList
                      selectedQuestionId={selectedQuestionId}
                      onSaveToLibrary={handleSaveToLibrary}
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="document" className="m-0 min-h-0 flex-1 overflow-hidden">
                {isSavedToDb && surveyId ? (
                  <SurveyDocumentPanel surveyId={surveyId} />
                ) : (
                  <div className="grid h-full place-items-center text-sm text-gray-500">
                    설문을 먼저 저장하면 조사표를 붙일 수 있습니다.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Sidebar - Settings */}
          <SurveySettingsPanel slugInput={slugInput} onAutoGenerateSlug={handleAutoGenerateSlug} />
        </div>
      </div>

      {/* Floating Scroll Buttons */}
      {showScrollButtons && (
        <ScrollEdgeButtons onScrollTop={scrollToTop} onScrollBottom={scrollToBottom} />
      )}

      {/* 저장 완료 모달 */}
      <SaveSuccessModal
        open={showSaveModal}
        onOpenChange={setShowSaveModal}
        slugInput={slugInput}
        slugError={slugError}
        titleInput={titleInput}
        onSlugChange={handleSlugChange}
        onAutoGenerateSlug={handleAutoGenerateSlug}
      />

      {/* 질문 저장 모달 */}
      <SaveQuestionModal
        open={showSaveQuestionModal}
        onOpenChange={setShowSaveQuestionModal}
        question={questionToSave}
        onSaved={() => {
          setQuestionToSave(null);
        }}
      />

      {/* 라이브러리 내보내기/가져오기 모달 */}
      <ImportExportLibraryModal
        open={showImportExportModal}
        onOpenChange={setShowImportExportModal}
      />
    </div>
  );
}
