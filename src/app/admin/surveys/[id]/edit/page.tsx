'use client';

import { use, useEffect, useState } from 'react';

import Link from 'next/link';

import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckSquare,
  ChevronDown,
  Circle,
  Download,
  FileText,
  Info,
  Library,
  List,
  ListOrdered,
  PlayCircle,
  Plus,
  Rocket,
  Save,
  Share2,
  Table,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { client } from '@/shared/lib/rpc';
import type { VarNameIssue } from '@/lib/spss/variable-name-guard';
import { useErrorDialogStore } from '@/stores/error-dialog-store';
import { ImportExportLibraryModal } from '@/components/survey-builder/import-export-library-modal';
import { QuestionLibraryPanel } from '@/components/survey-builder/question-library-panel';
import { ResponseHeaderSettingsModal } from '@/components/survey-builder/response-header-settings-modal';
import { SaveQuestionModal } from '@/components/survey-builder/save-question-modal';
import { SaveSuccessModal } from '@/components/survey-builder/save-success-modal';
import { SortableQuestionList } from '@/components/survey-builder/sortable-question-list';
import { SurveySettingsPanel } from '@/components/survey-builder/survey-settings-panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSurvey } from '@/hooks/queries/use-surveys';
import { useSurveySync } from '@/hooks/use-survey-sync';
import { generateSlugFromTitle, validateSlug } from '@/lib/survey-url';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';
import { Question } from '@/types/survey';

const questionTypes = [
  {
    type: 'notice' as const,
    label: '공지사항',
    icon: Info,
    description: '설명 및 안내 문구',
    color: 'bg-blue-100 text-blue-600',
  },
  {
    type: 'text' as const,
    label: '단답형',
    icon: Type,
    description: '짧은 텍스트 입력',
    color: 'bg-sky-100 text-sky-600',
  },
  {
    type: 'textarea' as const,
    label: '장문형',
    icon: FileText,
    description: '긴 텍스트 입력',
    color: 'bg-green-100 text-green-600',
  },
  {
    type: 'radio' as const,
    label: '단일선택',
    icon: Circle,
    description: '하나만 선택 가능',
    color: 'bg-purple-100 text-purple-600',
  },
  {
    type: 'checkbox' as const,
    label: '다중선택',
    icon: CheckSquare,
    description: '여러 개 선택 가능',
    color: 'bg-orange-100 text-orange-600',
  },
  {
    type: 'select' as const,
    label: '드롭다운',
    icon: ChevronDown,
    description: '드롭다운 메뉴',
    color: 'bg-pink-100 text-pink-600',
  },
  {
    type: 'multiselect' as const,
    label: '다단계선택',
    icon: List,
    description: '다중 드롭다운',
    color: 'bg-teal-100 text-teal-600',
  },
  {
    type: 'ranking' as const,
    label: '순위형',
    icon: ListOrdered,
    description: '순위 매기기 (1순위, 2순위...)',
    color: 'bg-amber-100 text-amber-600',
  },
  {
    type: 'table' as const,
    label: '테이블',
    icon: Table,
    description: '표 형태 질문',
    color: 'bg-indigo-100 text-indigo-600',
  },
];

interface EditSurveyPageProps {
  params: Promise<{ id: string }>;
}

export default function EditSurveyPage({ params }: EditSurveyPageProps) {
  const { id } = use(params);
  // 액션 (안정적 참조)
  const { updateSurveyTitle, addQuestion, addPreparedQuestion, updateSurveySlug, markPublished } =
    useSurveyBuilderStore(
      useShallow((s) => ({
        updateSurveyTitle: s.updateSurveyTitle,
        addQuestion: s.addQuestion,
        addPreparedQuestion: s.addPreparedQuestion,
        updateSurveySlug: s.updateSurveySlug,
        markPublished: s.markPublished,
      })),
    );

  // Primitive 상태 (값 비교)
  const { surveyId, isModifiedSincePublish } = useSurveyBuilderStore(
    useShallow((s) => ({
      surveyId: s.currentSurvey.id,
      isModifiedSincePublish: s.isModifiedSincePublish,
    })),
  );

  // 질문/그룹 배열은 SortableQuestionList 내부에서 직접 구독
  // 페이지에서는 길이만 구독하여 리렌더 최소화
  const questionCount = useSurveyBuilderStore((s) => s.currentSurvey.questions.length);
  const groupCount = useSurveyBuilderStore((s) => (s.currentSurvey.groups || []).length);
  const isDirty = useSurveyBuilderStore((s) => s.isDirty);

  const { selectedQuestionId, isTestMode, selectQuestion, toggleTestMode, setVariableCatalog } = useSurveyUIStore(
    useShallow((s) => ({
      selectedQuestionId: s.selectedQuestionId,
      isTestMode: s.isTestMode,
      selectQuestion: s.selectQuestion,
      toggleTestMode: s.toggleTestMode,
      setVariableCatalog: s.setVariableCatalog,
    })),
  );
  // TanStack Query 훅 사용
  const { data: survey, isLoading: isSurveyLoading, isError } = useSurvey(id);
  const { saveSurvey } = useSurveySync();

  const [titleInput, setTitleInput] = useState('');
  const [questionNumberInput, setQuestionNumberInput] = useState('');
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [slugError, setSlugError] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [initializedSurveyId, setInitializedSurveyId] = useState<string | null>(null);

  // 라이브러리 관련 상태
  const [leftSidebarTab, setLeftSidebarTab] = useState<'types' | 'library'>('types');
  const [showSaveQuestionModal, setShowSaveQuestionModal] = useState(false);
  const [questionToSave, setQuestionToSave] = useState<Question | null>(null);
  const [showImportExportModal, setShowImportExportModal] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // 설문 불러오기 - 초기 로드 또는 다른 설문으로 전환 시에만 스토어 세팅
  useEffect(() => {
    if (survey && initializedSurveyId !== id) {
      useSurveyBuilderStore.getState().setSurvey(survey);
      setTitleInput(survey.title);
      setSlugInput(survey.slug || '');
      setInitializedSurveyId(id);
    }
  }, [survey, initializedSurveyId, id]);

  // 변수 카탈로그 fetch (prefill 토큰 빌더 UI용)
  useEffect(() => {
    client.surveyBuilder.read.variableCatalog({ surveyId: id }).then((catalog) => {
      setVariableCatalog(catalog);
    }).catch(() => {
      // 컨택 없는 설문이면 빈 배열 — 정상 케이스
    });
  }, [id, setVariableCatalog]);

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
    // 빈 값이거나 유효하지 않은 값이면 검사하지 않음
    if (!slugInput) {
      setSlugError('');
      return;
    }

    const validation = validateSlug(slugInput);
    if (!validation.isValid) {
      // 클라이언트 사이드 검사는 이미 handleSlugChange에서 처리됨
      return;
    }

    let cancelled = false;

    // 500ms 후에 서버 검사 수행
    const timer = setTimeout(async () => {
      try {
        const isAvailable = await client.surveyBuilder.read.slugAvailable({
          slug: slugInput,
          ...(surveyId ? { excludeSurveyId: surveyId } : {}),
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

  // 제목에서 자동 슬러그 생성
  const handleAutoGenerateSlug = async () => {
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
    }
  };

  // 스크롤 감지 (성능 최적화: requestAnimationFrame 사용)
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setShowScrollButtons(window.scrollY > 200);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 설문 저장 (diff 기반)
  const handleSaveSurvey = async () => {
    const latestSurvey = useSurveyBuilderStore.getState().currentSurvey;
    // 공개 설문인데 슬러그가 없으면 자동 생성
    if (latestSurvey.settings.isPublic && !slugInput) {
      await handleAutoGenerateSlug();
    }

    try {
      await saveSurvey();
      setShowSaveModal(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('이미 사용 중인 URL') || message.includes('slug_unique') || message.includes('23505')) {
        setSlugError('이미 사용 중인 URL입니다. 다른 URL을 입력해주세요.');
      } else {
        toast.error('설문 저장에 실패했습니다. 다시 시도해주세요.');
      }
    }
  };

  // 설문 배포
  const handlePublishSurvey = async () => {
    if (!surveyId) return;

    const confirmed = window.confirm(
      '설문을 배포하시겠습니까?\n배포하면 현재 설문 상태가 스냅샷으로 저장되고, 응답자는 배포된 버전으로 응답하게 됩니다.'
    );
    if (!confirmed) return;

    setIsPublishing(true);
    try {
      // 배포 전 저장
      await saveSurvey();

      const version = await client.surveyBuilder.publish.publish({ surveyId });
      markPublished();
      toast.success(`설문이 배포되었습니다. 버전 ${version.versionNumber}`);
    } catch (error) {
      const issues = (error as { data?: { issues?: VarNameIssue[] } })?.data?.issues;
      if (issues && issues.length > 0) {
        useErrorDialogStore.getState().show({
          title: 'SPSS 변수명 오류로 배포가 중단되었습니다',
          description: '빌더에서 해당 변수명을 수정한 뒤 다시 배포하세요.',
          issues,
        });
      } else {
        toast.error(`배포 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      }
    } finally {
      setIsPublishing(false);
    }
  };

  // 맨 위로 스크롤
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 맨 아래로 스크롤
  const scrollToBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  // 특정 질문으로 스크롤
  const scrollToQuestion = (questionNumber: number) => {
    const questions = useSurveyBuilderStore.getState().currentSurvey.questions;
    const questionIndex = questionNumber - 1;
    if (questionIndex >= 0 && questionIndex < questions.length) {
      const targetQuestion = questions[questionIndex];
      const questionElement = document.querySelector(`[data-question-index="${questionIndex}"]`);
      if (questionElement && targetQuestion) {
        questionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectQuestion(targetQuestion.id);
      }
    }
  };

  // 질문 번호 입력 핸들러
  const handleQuestionNumberKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const questionNumber = parseInt(questionNumberInput, 10);
      if (!isNaN(questionNumber) && questionNumber > 0) {
        scrollToQuestion(questionNumber);
        setQuestionNumberInput('');
      }
    }
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

  // 로딩 상태
  if (isSurveyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
          <p className="text-gray-600">설문을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 설문을 찾을 수 없는 경우
  if (isError || (!isSurveyLoading && !survey)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">설문을 찾을 수 없습니다</h2>
          <p className="mb-6 text-gray-500">요청하신 설문이 존재하지 않거나 삭제되었습니다.</p>
          <Button asChild>
            <Link href="/admin/surveys">
              <ArrowLeft className="mr-2 h-4 w-4" />
              목록으로 돌아가기
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/admin/surveys">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                목록으로
              </Button>
            </Link>
            <div className="h-6 w-px bg-gray-300" />
            <Input
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
            <Button
              variant={isTestMode ? 'default' : 'outline'}
              size="sm"
              onClick={toggleTestMode}
              className={isTestMode ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              {isTestMode ? '테스트 중' : '테스트'}
            </Button>
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
                  {questionTypes.map((questionType) => {
                    const IconComponent = questionType.icon;
                    return (
                      <Card
                        key={questionType.type}
                        className="hover-lift cursor-pointer border-gray-200 p-4 transition-all duration-200 hover:border-blue-200"
                        onClick={() => {
                          addQuestion(questionType.type);
                        }}
                      >
                        <div className="flex items-start space-x-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-lg ${questionType.color}`}
                          >
                            <IconComponent className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-medium text-gray-900">
                              {questionType.label}
                            </h4>
                            <p className="mt-1 text-xs text-gray-500">{questionType.description}</p>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
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

          {/* Center - Survey Preview/Edit */}
          <div className="max-h-[calc(100vh-140px)] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {isTestMode ? '질문 테스트' : '설문 편집'}
                  </h3>
                  {isTestMode && (
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">
                      테스트 모드
                    </span>
                  )}
                  {!isTestMode && questionCount > 0 && (
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
                      <span className="text-xs text-gray-500">
                        / {questionCount}
                      </span>
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
                  <h3 className="mb-2 text-lg font-medium text-gray-900">질문을 추가해보세요</h3>
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
                  isTestMode={isTestMode}
                  onSaveToLibrary={handleSaveToLibrary}
                />
              )}
            </div>
          </div>

          {/* Right Sidebar - Settings */}
          <SurveySettingsPanel
            slugInput={slugInput}
            onAutoGenerateSlug={handleAutoGenerateSlug}
          />
        </div>
      </div>

      {/* Floating Scroll Buttons */}
      {showScrollButtons && (
        <div className="fixed right-6 bottom-6 z-50 flex flex-col space-y-2">
          <Button
            onClick={scrollToTop}
            size="sm"
            className="h-12 w-12 rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg transition-all duration-200 hover:scale-110 hover:bg-gray-50"
            title="맨 위로"
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
          <Button
            onClick={scrollToBottom}
            size="sm"
            className="h-12 w-12 rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg transition-all duration-200 hover:scale-110 hover:bg-gray-50"
            title="맨 아래로"
          >
            <ArrowDown className="h-5 w-5" />
          </Button>
        </div>
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
