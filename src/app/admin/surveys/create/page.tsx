'use client';

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckSquare,
  ChevronDown,
  Circle,
  Copy,
  Download,
  FileText,
  Globe,
  Info,
  Library,
  List,
  ListOrdered,
  Lock,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Share2,
  Table,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { GroupManager } from '@/components/survey-builder/group-manager';
import { ImportExportLibraryModal } from '@/components/survey-builder/import-export-library-modal';
import { QuestionLibraryPanel } from '@/components/survey-builder/question-library-panel';
import { SaveQuestionModal } from '@/components/survey-builder/save-question-modal';
import { SortableQuestionList } from '@/components/survey-builder/sortable-question-list';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSaveSurvey } from '@/hooks/queries/use-surveys';
import { formatLocalDate } from '@/lib/date-formatters';
import {
  encodeSurveyIdentifier,
  generateSlugFromTitle,
  getSurveyAccessUrl,
  validateSlug,
} from '@/lib/survey-url';
import { generateId } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';
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

export default function CreateSurveyPage() {
  const router = useRouter();
  const {
    updateSurveyTitle,
    addQuestion,
    addPreparedQuestion,
    updateSurveySettings,
    updateSurveySlug,
    regeneratePrivateToken,
    resetSurvey,
  } = useSurveyBuilderStore(
    useShallow((s) => ({
      updateSurveyTitle: s.updateSurveyTitle,
      addQuestion: s.addQuestion,
      addPreparedQuestion: s.addPreparedQuestion,
      updateSurveySettings: s.updateSurveySettings,
      updateSurveySlug: s.updateSurveySlug,
      regeneratePrivateToken: s.regeneratePrivateToken,
      resetSurvey: s.resetSurvey,
    })),
  );
  const currentSurvey = useSurveyBuilderStore((s) => s.currentSurvey);

  const { selectedQuestionId, isTestMode, selectQuestion, toggleTestMode } = useSurveyUIStore();

  const { mutateAsync: saveSurvey } = useSaveSurvey();

  const [titleInput, setTitleInput] = useState('새 설문조사');
  const [questionNumberInput, setQuestionNumberInput] = useState('');
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [slugError, setSlugError] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isEditingSlugInModal, setIsEditingSlugInModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // 라이브러리 관련 상태
  const [leftSidebarTab, setLeftSidebarTab] = useState<'types' | 'library'>('types');
  const [showSaveQuestionModal, setShowSaveQuestionModal] = useState(false);
  const [questionToSave, setQuestionToSave] = useState<Question | null>(null);
  const [showImportExportModal, setShowImportExportModal] = useState(false);

  // 새 설문 생성 시 초기화
  useEffect(() => {
    resetSurvey();
  }, [resetSurvey]);

  // 슬러그 입력 핸들러 (입력값만 업데이트, 서버 호출은 제거)
  const handleSlugChange = useCallback(
    (value: string) => {
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
    },
    [updateSurveySlug],
  );

  // 슬러그 중복 검사 (Debounce 적용 - 500ms 지연)
  useEffect(() => {
    // 빈 값이거나 유효하지 않은 값이면 검사하지 않음
    if (!slugInput) {
      return;
    }

    const validation = validateSlug(slugInput);
    if (!validation.isValid) {
      // 클라이언트 사이드 검사는 이미 handleSlugChange에서 처리됨
      return;
    }

    // 500ms 후에 서버 검사 수행
    const timer = setTimeout(async () => {
      try {
        const available = await client.surveyBuilder.read.slugAvailable({
          slug: slugInput,
          ...(currentSurvey.id ? { excludeSurveyId: currentSurvey.id } : {}),
        });
        if (!available) {
          setSlugError('이미 사용 중인 URL입니다. 다른 URL을 입력해주세요.');
        } else {
          setSlugError('');
        }
      } catch (error) {
        console.error('슬러그 중복 검사 실패:', error);
        // 에러 발생 시 에러 메시지 표시하지 않음 (사용자 경험 고려)
      }
    }, 500); // 0.5초 대기

    // cleanup: 타이핑이 계속되면 이전 타이머 취소
    return () => clearTimeout(timer);
  }, [slugInput, currentSurvey.id]);

  // 제목에서 자동 슬러그 생성 (생성된 슬러그를 반환해 저장 페이로드에 즉시 반영 가능)
  const handleAutoGenerateSlug = useCallback(async (): Promise<string | undefined> => {
    const autoSlug = generateSlugFromTitle(titleInput);
    if (autoSlug) {
      // 중복 시 접미사 추가
      let finalSlug = autoSlug;
      let counter = 1;
      let available = await client.surveyBuilder.read.slugAvailable({
        slug: finalSlug,
        ...(currentSurvey.id ? { excludeSurveyId: currentSurvey.id } : {}),
      });
      while (!available) {
        finalSlug = `${autoSlug}-${counter}`;
        counter++;
        available = await client.surveyBuilder.read.slugAvailable({
          slug: finalSlug,
          ...(currentSurvey.id ? { excludeSurveyId: currentSurvey.id } : {}),
        });
      }
      setSlugInput(finalSlug);
      updateSurveySlug(finalSlug);
      setSlugError('');
      return finalSlug;
    }
    return undefined;
  }, [titleInput, currentSurvey.id, updateSurveySlug]);

  // URL 복사
  const handleCopyUrl = () => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const url = getSurveyAccessUrl(
      {
        id: currentSurvey.id,
        slug: slugInput || generateSlugFromTitle(titleInput),
        privateToken: currentSurvey.privateToken,
        settings: currentSurvey.settings,
      },
      baseUrl,
    );

    navigator.clipboard.writeText(url);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // 비공개 토큰 재생성
  const handleRegenerateToken = () => {
    if (confirm('새로운 비공개 링크를 생성하시겠습니까? 기존 링크는 더 이상 사용할 수 없습니다.')) {
      regeneratePrivateToken();
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

  // 설문 저장
  const handleSaveSurvey = async () => {
    // ID가 없으면 새로 생성
    let surveyToSave = currentSurvey.id ? currentSurvey : { ...currentSurvey, id: generateId() };

    // 공개 설문인데 슬러그가 없으면 자동 생성
    // handleAutoGenerateSlug는 store/state에만 기록되므로 반환값을 페이로드에 직접 반영해야 한다
    if (surveyToSave.settings.isPublic && !slugInput) {
      const generatedSlug = await handleAutoGenerateSlug();
      if (generatedSlug) {
        surveyToSave = { ...surveyToSave, slug: generatedSlug };
      }
    }

    try {
      await saveSurvey(surveyToSave);
      setShowSaveModal(true);
      setCopySuccess(false);
      setIsEditingSlugInModal(false);
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
    const questionIndex = questionNumber - 1;
    if (questionIndex >= 0 && questionIndex < currentSurvey.questions.length) {
      const targetQuestion = currentSurvey.questions[questionIndex];
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
            <Button size="sm">
              <Share2 className="mr-2 h-4 w-4" />
              공유
            </Button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl p-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - Question Types & Library */}
          <div className="col-span-3 flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <Tabs
              value={leftSidebarTab}
              onValueChange={(v) => setLeftSidebarTab(v as 'types' | 'library')}
              className="flex h-full flex-col"
            >
              <TabsList className="m-2 mb-0 grid w-full grid-cols-2 p-1">
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
                  {questionTypes.map((questionType) => {
                    const IconComponent = questionType.icon;
                    return (
                      <Card
                        key={questionType.type}
                        className="hover-lift cursor-pointer border-gray-200 p-4 transition-all duration-200 hover:border-blue-200"
                        onClick={() => addQuestion(questionType.type)}
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
                    <p>그룹 수: {(currentSurvey.groups || []).length}개</p>
                    <p>질문 수: {currentSurvey.questions.length}개</p>
                    <p suppressHydrationWarning>
                      마지막 수정: {formatLocalDate(currentSurvey.updatedAt)}
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="library" className="m-0 flex-1 overflow-y-auto p-4 pt-2">
                <QuestionLibraryPanel onAddQuestion={handleAddFromLibrary} className="h-full" />

                {/* 내보내기/가져오기 버튼 */}
                <div className="mt-4 border-t border-gray-200 pt-4">
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
          <div className="col-span-6 max-h-[calc(100vh-140px)] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm">
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
                  {!isTestMode && currentSurvey.questions.length > 0 && (
                    <div className="flex items-center space-x-2">
                      <Input
                        type="number"
                        min="1"
                        max={currentSurvey.questions.length}
                        value={questionNumberInput}
                        onChange={(e) => setQuestionNumberInput(e.target.value)}
                        onKeyPress={handleQuestionNumberKeyPress}
                        placeholder="질문 번호"
                        className="h-8 w-24 text-sm"
                      />
                      <span className="text-xs text-gray-500">
                        / {currentSurvey.questions.length}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-sm text-gray-500">{currentSurvey.questions.length}개 질문</div>
              </div>
            </div>

            <div className="p-6">
              {currentSurvey.questions.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                    <Plus className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="mb-2 text-lg font-medium text-gray-900">질문을 추가해보세요</h3>
                  <p className="mb-6 text-gray-500">
                    왼쪽에서 원하는 질문 유형을 클릭하거나 보관함에서 불러올 수 있습니다.
                  </p>
                  <div className="flex justify-center gap-2">
                    <Button onClick={() => addQuestion('text')}>
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
          <div className="col-span-3 max-h-[calc(100vh-140px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-6 text-lg font-semibold text-gray-900">설정</h3>

            <div className="space-y-6">
              {/* 설문 설정 */}
              <div>
                <h4 className="mb-3 text-sm font-medium text-gray-700">설문 설정</h4>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {currentSurvey.settings.isPublic ? (
                        <Globe className="h-4 w-4 text-green-600" />
                      ) : (
                        <Lock className="h-4 w-4 text-gray-500" />
                      )}
                      <label className="text-sm text-gray-600">공개 설문</label>
                    </div>
                    <input
                      type="checkbox"
                      checked={currentSurvey.settings.isPublic}
                      onChange={(e) => {
                        updateSurveySettings({ isPublic: e.target.checked });
                        // 공개로 전환 시 자동 슬러그 생성
                        if (e.target.checked && !slugInput) {
                          handleAutoGenerateSlug();
                        }
                      }}
                      className="rounded"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-600">진행률 표시</label>
                    <input
                      type="checkbox"
                      checked={currentSurvey.settings.showProgressBar}
                      onChange={(e) => updateSurveySettings({ showProgressBar: e.target.checked })}
                      className="rounded"
                    />
                  </div>
                </div>
              </div>

              {/* 그룹 관리 */}
              <div className="border-t border-gray-200 pt-6">
                <GroupManager className="max-h-[400px]" />
              </div>
            </div>
          </div>
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
      <Dialog open={showSaveModal} onOpenChange={setShowSaveModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                <Check className="h-5 w-5 text-green-600" />
              </div>
              설문이 저장되었습니다!
            </DialogTitle>
            <DialogDescription>
              {currentSurvey.settings.isPublic
                ? '공개 설문 URL을 복사하여 공유하세요.'
                : '비공개 링크를 아는 사람만 설문에 접근할 수 있습니다.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {currentSurvey.settings.isPublic ? (
              // 공개 설문 URL
              <>
                <div>
                  <Label className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Globe className="h-4 w-4 text-green-600" />
                    공개 설문 URL
                  </Label>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm break-all text-gray-700">
                      {typeof window !== 'undefined' ? window.location.origin : ''}/survey/
                      <span className="font-medium text-blue-600">
                        {encodeSurveyIdentifier(slugInput || generateSlugFromTitle(titleInput))}
                      </span>
                    </p>
                  </div>
                </div>

                {/* URL 슬러그 편집 */}
                {isEditingSlugInModal ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">URL 슬러그 변경</Label>
                    <div className="flex gap-2">
                      <Input
                        value={slugInput || generateSlugFromTitle(titleInput)}
                        onChange={(e) => handleSlugChange(e.target.value)}
                        placeholder="my-survey"
                        className={`flex-1 ${slugError ? 'border-red-300' : ''}`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAutoGenerateSlug}
                        title="자동 생성"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                    {slugError && (
                      <p className="flex items-center gap-1 text-xs text-red-500">
                        <AlertCircle className="h-3 w-3" />
                        {slugError}
                      </p>
                    )}
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    onClick={handleCopyUrl}
                    className="flex-1"
                    variant={copySuccess ? 'default' : 'outline'}
                  >
                    {copySuccess ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        복사됨!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-4 w-4" />
                        URL 복사
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsEditingSlugInModal(!isEditingSlugInModal)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {isEditingSlugInModal ? '완료' : 'URL 변경'}
                  </Button>
                </div>
              </>
            ) : (
              // 비공개 설문 URL
              <>
                <div>
                  <Label className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Lock className="h-4 w-4 text-amber-600" />
                    비공개 설문 URL
                  </Label>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="font-mono text-sm break-all text-gray-700">
                      {typeof window !== 'undefined' ? window.location.origin : ''}/survey/
                      {encodeSurveyIdentifier(currentSurvey.privateToken || currentSurvey.id)}
                    </p>
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs text-amber-600">
                    <AlertCircle className="h-3 w-3" />이 링크를 아는 사람만 설문에 접근할 수
                    있습니다
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleCopyUrl}
                    className="flex-1"
                    variant={copySuccess ? 'default' : 'outline'}
                  >
                    {copySuccess ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        복사됨!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-4 w-4" />
                        URL 복사
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleRegenerateToken}>
                    <RefreshCw className="mr-2 h-4 w-4" />새 링크 생성
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-2">
            <Button variant="outline" onClick={() => setShowSaveModal(false)}>
              확인
            </Button>
            <Button onClick={() => router.push('/admin/surveys')}>설문 목록으로</Button>
          </div>
        </DialogContent>
      </Dialog>

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
