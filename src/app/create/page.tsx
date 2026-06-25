'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckSquare,
  ChevronDown,
  Circle,
  FileText,
  FolderOpen,
  Info,
  List,
  ListOrdered,
  PlayCircle,
  Plus,
  Save,
  Share2,
  Table,
  Trash2,
  Type,
} from 'lucide-react';

import { GroupManager } from '@/components/survey-builder/group-manager';
import { SortableQuestionList } from '@/components/survey-builder/sortable-question-list';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useDeleteSurvey, useSaveSurvey, useSurveys } from '@/hooks/queries/use-surveys';
import { formatLocalDate } from '@/lib/date-formatters';
import { generateId } from '@/lib/utils';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';
import { useShallow } from 'zustand/react/shallow';

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
  const {
    updateSurveyTitle,
    addQuestion,
    updateSurveySettings,
    resetSurvey,
  } = useSurveyBuilderStore(
    useShallow((s) => ({
      updateSurveyTitle: s.updateSurveyTitle,
      addQuestion: s.addQuestion,
      updateSurveySettings: s.updateSurveySettings,
      resetSurvey: s.resetSurvey,
    })),
  );
  const currentSurvey = useSurveyBuilderStore((s) => s.currentSurvey);

  const { selectedQuestionId, isTestMode, selectQuestion, toggleTestMode } = useSurveyUIStore();

  const { data: surveys = [] } = useSurveys();
  const { mutateAsync: saveSurvey } = useSaveSurvey();
  const { mutateAsync: deleteSurveyMutation } = useDeleteSurvey();

  const [titleInput, setTitleInput] = useState(currentSurvey.title);
  const [showSavedSurveys, setShowSavedSurveys] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [questionNumberInput, setQuestionNumberInput] = useState('');
  const [showScrollButtons, setShowScrollButtons] = useState(false);

  // 스크롤 감지
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 200) {
        setShowScrollButtons(true);
      } else {
        setShowScrollButtons(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 설문 저장
  const handleSaveSurvey = async () => {
    // ID가 없으면 새로 생성
    const surveyToSave = currentSurvey.id ? currentSurvey : { ...currentSurvey, id: generateId() };

    await saveSurvey(surveyToSave);
    setSaveMessage('저장되었습니다!');

    setTimeout(() => setSaveMessage(''), 2000);
  };

  // 설문 불러오기
  const handleLoadSurvey = (surveyId: string) => {
    const survey = surveys.find((s) => s.id === surveyId);
    if (survey) {
      // 기본 정보만 있으므로 상세 정보는 별도 로드 필요
      setShowSavedSurveys(false);
    }
  };

  // 새 설문 시작
  const handleNewSurvey = () => {
    if (confirm('현재 작업 중인 설문을 저장하지 않고 새로 시작하시겠습니까?')) {
      resetSurvey();
      setTitleInput('새 설문조사');
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
        // 해당 질문 선택
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                돌아가기
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
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSavedSurveys(!showSavedSurveys)}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                불러오기
                {surveys.length > 0 && (
                  <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600">
                    {surveys.length}
                  </span>
                )}
              </Button>

              {showSavedSurveys && surveys.length > 0 && (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="flex items-center justify-between border-b border-gray-200 p-3">
                    <h4 className="text-sm font-medium">저장된 설문</h4>
                    <Button size="sm" variant="ghost" onClick={handleNewSurvey} className="text-xs">
                      <Plus className="mr-1 h-3 w-3" />새 설문
                    </Button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {surveys.map((survey) => (
                      <div
                        key={survey.id}
                        className="group flex items-start justify-between border-b border-gray-100 p-3 last:border-b-0 hover:bg-gray-50"
                      >
                        <button
                          onClick={() => handleLoadSurvey(survey.id)}
                          className="flex-1 text-left"
                        >
                          <h5 className="text-sm font-medium text-gray-900">{survey.title}</h5>
                          <p className="mt-1 text-xs text-gray-500">
                            전체 {survey.responseCount.toLocaleString('ko-KR')}건 · 완료{' '}
                            {survey.completedResponseCount.toLocaleString('ko-KR')}건 ·{' '}
                            {formatLocalDate(survey.updatedAt)}
                          </p>
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('이 설문을 삭제하시겠습니까?')) {
                              deleteSurveyMutation(survey.id);
                            }
                          }}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button
              variant={isTestMode ? 'default' : 'outline'}
              size="sm"
              onClick={toggleTestMode}
              className={isTestMode ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              {isTestMode ? '테스트 중' : '테스트'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleSaveSurvey} className="relative">
              <Save className="mr-2 h-4 w-4" />
              저장
              {saveMessage && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 transform rounded bg-green-600 px-2 py-1 text-xs whitespace-nowrap text-white">
                  <Check className="mr-1 inline h-3 w-3" />
                  {saveMessage}
                </span>
              )}
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
          {/* Left Sidebar - Question Types */}
          <div className="col-span-3 max-h-[calc(100vh-140px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-6 text-lg font-semibold text-gray-900">질문 유형</h3>

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
                        <h4 className="text-sm font-medium text-gray-900">{questionType.label}</h4>
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
                <p>마지막 수정: {formatLocalDate(currentSurvey.updatedAt)}</p>
              </div>
            </div>
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
                    왼쪽에서 원하는 질문 유형을 클릭하여 추가할 수 있습니다.
                  </p>
                  <Button onClick={() => addQuestion('text')}>
                    <Plus className="mr-2 h-4 w-4" />첫 번째 질문 추가
                  </Button>
                </div>
              ) : (
                <SortableQuestionList
                  selectedQuestionId={selectedQuestionId}
                  isTestMode={isTestMode}
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
                    <label className="text-sm text-gray-600">공개 설문</label>
                    <input
                      type="checkbox"
                      checked={currentSurvey.settings.isPublic}
                      onChange={(e) => updateSurveySettings({ isPublic: e.target.checked })}
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
    </div>
  );
}
