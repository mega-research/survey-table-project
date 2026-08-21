'use client';

import { useEffect, useEffectEvent, useState } from 'react';

import { ArrowRight, Check, ChevronsUpDown, GitBranch, Info, XCircle } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn, generateId } from '@/lib/utils';
import { BranchAction, BranchRule, Question } from '@/types/survey';

interface BranchRuleEditorProps {
  branchRule?: BranchRule | undefined;
  allQuestions: Question[];
  currentQuestionId: string;
  onChange: (branchRule: BranchRule | undefined) => void;
}

export function BranchRuleEditor({
  branchRule,
  allQuestions,
  currentQuestionId,
  onChange,
}: BranchRuleEditorProps) {
  const [enabled, setEnabled] = useState(!!branchRule);
  const [action, setAction] = useState<BranchAction>(branchRule?.action || 'goto');
  const [targetQuestionId, setTargetQuestionId] = useState(branchRule?.targetQuestionId || '');
  const [open, setOpen] = useState(false);

  // 현재 질문 이후의 질문만 필터링
  const currentIndex = allQuestions.findIndex((q) => q.id === currentQuestionId);
  const availableQuestions = allQuestions.filter((_, index) => index > currentIndex);

  // branchRule prop이 변경될 때 state 동기화 — effect 대신 렌더 중 조정 패턴
  const [prevBranchRule, setPrevBranchRule] = useState(branchRule);
  if (prevBranchRule !== branchRule) {
    setPrevBranchRule(branchRule);
    if (branchRule) {
      setEnabled(true);
      setAction(branchRule.action || 'goto');
      setTargetQuestionId(branchRule.targetQuestionId || '');
    } else {
      setEnabled(false);
      setAction('goto');
      setTargetQuestionId('');
    }
  }

  // 로컬 편집값(enabled/action/targetQuestionId)이 바뀔 때만 부모로 규칙을 밀어 올린다.
  // onChange/branchRule 은 호출자가 인라인으로 넘겨 매 렌더 identity 가 바뀌므로 deps 에 넣으면
  // 부모 setState → 재렌더 → 재발화의 무한 루프가 된다. effect event 로 최신값만 읽는다.
  const emitChange = useEffectEvent(() => {
    if (!enabled) {
      onChange(undefined);
    } else {
      const newBranchRule: BranchRule = {
        id: branchRule?.id || generateId(),
        value: branchRule?.value || '',
        action,
        ...(action === 'goto' ? { targetQuestionId } : {}),
      };
      onChange(newBranchRule);
    }
  });
  useEffect(() => {
    emitChange();
  }, [enabled, action, targetQuestionId]);

  if (!enabled) {
    return (
      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-gray-400" />
            <Label className="cursor-pointer text-sm text-gray-600" htmlFor="branch-toggle">
              조건부 분기
            </Label>
          </div>
          <Switch
            id="branch-toggle"
            checked={enabled}
            onCheckedChange={setEnabled}
            className="scale-90"
          />
        </div>
        <p className="mt-1 ml-6 text-xs text-gray-500">이 옵션 선택 시 다음 질문으로 순차 이동</p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-blue-600" />
          <Label className="text-sm font-medium text-gray-900">조건부 분기 설정</Label>
        </div>
        <Switch
          id="branch-toggle"
          checked={enabled}
          onCheckedChange={setEnabled}
          className="scale-90"
        />
      </div>

      <div className="space-y-3 pl-6">
        {/* 분기 동작 선택 */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">이 옵션 선택 시</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction('goto')}
              className={`flex-1 rounded-lg border-2 px-3 py-2 transition-all ${
                action === 'goto'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <ArrowRight className="h-4 w-4" />
                <span className="text-sm font-medium">질문 이동</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setAction('end')}
              className={`flex-1 rounded-lg border-2 px-3 py-2 transition-all ${
                action === 'end'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <XCircle className="h-4 w-4" />
                <span className="text-sm font-medium">설문 종료</span>
              </div>
            </button>
          </div>
        </div>

        {/* 질문 이동 옵션 */}
        {action === 'goto' && (
          <div className="space-y-2">
            <Label className="text-xs font-medium text-gray-600">이동할 질문 선택</Label>
            {availableQuestions.length > 0 ? (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-controls="branch-rule-question-listbox"
                    aria-label={
                      targetQuestionId
                        ? `선택된 질문: ${
                            availableQuestions.find((q) => q.id === targetQuestionId)?.title || ''
                          }`
                        : '이동할 질문을 선택하세요'
                    }
                    className={cn(
                      'flex min-h-[48px] w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm shadow-sm transition-all hover:shadow-md focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none',
                      targetQuestionId
                        ? 'border-blue-500 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700'
                        : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50',
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpen(!open);
                      }
                    }}
                  >
                    <div className="flex flex-1 items-center gap-3">
                      <ArrowRight
                        className={cn(
                          'h-4 w-4 flex-shrink-0',
                          targetQuestionId ? 'text-blue-600' : 'text-gray-400',
                        )}
                      />
                      <span
                        className={cn(
                          'font-medium',
                          targetQuestionId ? 'text-blue-700' : 'text-gray-500',
                        )}
                      >
                        {targetQuestionId
                          ? (() => {
                              const selectedQuestion = availableQuestions.find(
                                (q) => q.id === targetQuestionId,
                              );
                              if (!selectedQuestion) return '질문을 선택하세요';
                              const index = availableQuestions.indexOf(selectedQuestion);
                              const title = selectedQuestion.title || '제목 없음';
                              const displayTitle =
                                title.length > 60 ? title.substring(0, 60) + '...' : title;
                              return `Q${currentIndex + index + 2}. ${displayTitle}`;
                            })()
                          : '질문을 선택하세요'}
                      </span>
                    </div>
                    <ChevronsUpDown
                      className={cn(
                        'ml-2 h-4 w-4 flex-shrink-0 transition-transform',
                        open ? 'rotate-180' : 'rotate-0',
                        targetQuestionId ? 'text-blue-600' : 'text-gray-400',
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[500px] border-2 p-0 shadow-xl" align="start">
                  <Command className="rounded-xl">
                    <div className="border-b bg-gray-50 px-3 py-2">
                      <CommandInput
                        placeholder="질문 번호나 제목으로 검색..."
                        className="border-0 bg-transparent text-sm placeholder:text-gray-500 focus:ring-0"
                      />
                    </div>
                    <CommandList id="branch-rule-question-listbox" className="max-h-64">
                      <CommandEmpty className="py-6 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-2">
                          <ArrowRight className="h-8 w-8 text-gray-300" />
                          <p className="text-sm">검색 결과가 없습니다</p>
                          <p className="text-xs text-gray-400">다른 키워드로 검색해보세요</p>
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {availableQuestions.map((q, index) => {
                          const title = q.title || '제목 없음';
                          const description = q.description || '';
                          const displayTitle =
                            title.length > 80 ? title.substring(0, 80) + '...' : title;
                          const displayDescription =
                            description.length > 120
                              ? description.substring(0, 120) + '...'
                              : description;
                          const questionNumber = `Q${currentIndex + index + 2}`;
                          const isSelected = targetQuestionId === q.id;

                          return (
                            <CommandItem
                              key={q.id}
                              value={`${questionNumber} ${title} ${description}`}
                              onSelect={() => {
                                setTargetQuestionId(q.id);
                                setOpen(false);
                              }}
                              className={cn(
                                'cursor-pointer px-4 py-3 transition-all hover:bg-blue-50 focus:bg-blue-50 focus:outline-none',
                                isSelected && 'border-l-4 border-blue-500 bg-blue-100',
                              )}
                              role="option"
                              aria-selected={isSelected}
                              aria-label={`질문 ${questionNumber}: ${title}${
                                description ? ` - ${description}` : ''
                              }`}
                            >
                              <div className="flex w-full items-start gap-3">
                                <Check
                                  className={cn(
                                    'mt-1 h-4 w-4 flex-shrink-0 transition-opacity',
                                    isSelected ? 'text-blue-600 opacity-100' : 'opacity-0',
                                  )}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="mb-1 flex items-center gap-2">
                                    <span
                                      className={cn(
                                        'rounded-full px-2 py-1 text-xs font-bold',
                                        isSelected
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-gray-200 text-gray-600',
                                      )}
                                    >
                                      {questionNumber}
                                    </span>
                                    <span
                                      className={cn(
                                        'rounded-full px-2 py-1 text-xs capitalize',
                                        q.type === 'text' && 'bg-sky-100 text-sky-700',
                                        q.type === 'textarea' && 'bg-green-100 text-green-700',
                                        q.type === 'radio' && 'bg-purple-100 text-purple-700',
                                        q.type === 'checkbox' && 'bg-orange-100 text-orange-700',
                                        q.type === 'select' && 'bg-pink-100 text-pink-700',
                                        q.type === 'table' && 'bg-indigo-100 text-indigo-700',
                                        ![
                                          'text',
                                          'textarea',
                                          'radio',
                                          'checkbox',
                                          'select',
                                          'table',
                                        ].includes(q.type) && 'bg-gray-100 text-gray-700',
                                      )}
                                    >
                                      {q.type}
                                    </span>
                                  </div>
                                  <p
                                    className={cn(
                                      'mb-1 text-sm leading-tight font-medium',
                                      isSelected ? 'text-blue-900' : 'text-gray-900',
                                    )}
                                  >
                                    {displayTitle}
                                  </p>
                                  {description && (
                                    <p className="text-xs leading-relaxed text-gray-500">
                                      {displayDescription}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">
                  이동 가능한 질문이 없습니다. 현재 질문 이후에 질문을 추가해주세요.
                </p>
              </div>
            )}
          </div>
        )}

        {/* 설문 종료 경고 */}
        {action === 'end' && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <p className="text-xs text-red-800">
              사용자가 이 옵션을 선택하면 설문이 즉시 종료되고 응답이 제출됩니다.
            </p>
          </div>
        )}

        {/* 분기 요약 */}
        {action === 'goto' && targetQuestionId && (
          <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
            <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
            <p className="text-xs text-green-800">
              <strong>분기 설정 완료:</strong>{' '}
              {availableQuestions.find((q) => q.id === targetQuestionId)?.title || '선택된 질문'}로
              이동합니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
