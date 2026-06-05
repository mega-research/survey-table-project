'use client';

import { useEffect, useState } from 'react';

import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  Circle,
  FileText,
  Info,
  List,
  ListOrdered,
  Plus,
  Save,
  Table,
  Tag,
  Type,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCategories, useCreateCategory, useSaveQuestion } from '@/hooks/queries/use-library';
import { cn } from '@/lib/utils';
import { hasBranchLogic } from '@/features/library/domain/saved-question';
import { Question } from '@/types/survey';

// 질문 타입 아이콘 매핑
const questionTypeIcons: Record<string, React.ElementType> = {
  text: Type,
  textarea: FileText,
  radio: Circle,
  checkbox: CheckSquare,
  select: ChevronDown,
  multiselect: List,
  ranking: ListOrdered,
  table: Table,
  notice: Info,
};

// 질문 타입 라벨
const questionTypeLabels: Record<string, string> = {
  text: '단답형',
  textarea: '장문형',
  radio: '단일선택',
  checkbox: '다중선택',
  select: '드롭다운',
  multiselect: '다단계선택',
  ranking: '순위형',
  table: '테이블',
  notice: '공지사항',
};

interface SaveQuestionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: Question | null;
  onSaved?: () => void;
}

export function SaveQuestionModal({
  open,
  onOpenChange,
  question,
  onSaved,
}: SaveQuestionModalProps) {
  const { data: categories = [], refetch: refetchCategories } = useCategories();
  const saveQuestionMutation = useSaveQuestion();
  const createCategoryMutation = useCreateCategory();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('custom');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [errors, setErrors] = useState<{ name?: string | undefined }>({});

  // 질문이 변경되면 기본값 설정
  useEffect(() => {
    if (question && open) {
      setName(question.title.slice(0, 50)); // 제목에서 기본 이름 추출
      setDescription(question.description || '');
      setSelectedCategory('custom');
      setTags([]);
      setNewTag('');
      setErrors({});
    }
  // deps 를 question?.id 로 좁힘 — 외부에서 question reference 가 바뀌어도
  // 사용자가 입력 중인 라이브러리 저장 폼이 reset 되지 않도록 한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, open]);

  // 태그 추가
  const handleAddTag = () => {
    const trimmedTag = newTag.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setNewTag('');
    }
  };

  // 태그 제거
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  // 태그 입력 키 핸들러
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  // 새 카테고리 추가
  const handleAddCategory = async () => {
    const trimmedName = newCategoryName.trim();
    if (trimmedName) {
      try {
        const newCategory = await createCategoryMutation.mutateAsync({
          name: trimmedName,
        });
        // 새로 추가된 카테고리 선택
        if (newCategory?.id) {
          setSelectedCategory(newCategory.id);
        }
        setNewCategoryName('');
        setShowNewCategory(false);
        await refetchCategories();
      } catch (error) {
        console.error('카테고리 추가 실패:', error);
      }
    }
  };

  // 저장 처리
  const handleSave = async () => {
    // 유효성 검사
    const newErrors: { name?: string } = {};
    if (!name.trim()) {
      newErrors.name = '질문 이름을 입력해주세요.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!question) return;

    try {
      await saveQuestionMutation.mutateAsync({
        question,
        metadata: {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          category: selectedCategory,
          tags,
        },
      });

      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error('질문 저장 실패:', error);
    }
  };

  if (!question) return null;

  const IconComponent = questionTypeIcons[question.type] || FileText;
  const hasLogic = hasBranchLogic(question);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-md overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Save className="h-4 w-4 text-blue-600 sm:h-5 sm:w-5" />
            질문 저장하기
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            이 질문을 저장하면 다른 설문에서 쉽게 재사용할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-3 sm:space-y-4 sm:py-4">
          {/* 질문 미리보기 */}
          <div className="rounded-lg border bg-gray-50 p-2.5 sm:p-3">
            <div className="flex items-start gap-2 sm:gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 sm:h-8 sm:w-8">
                <IconComponent className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs font-medium text-gray-900 sm:text-sm">
                  {question.title}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">
                  {questionTypeLabels[question.type]}
                  {question.options && ` · ${question.options.length}개 옵션`}
                </p>
              </div>
            </div>
          </div>

          {/* 분기 로직 경고 */}
          {hasLogic && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 sm:p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <div className="text-xs text-amber-700 sm:text-sm">
                <p className="font-medium">분기 로직 포함</p>
                <p className="mt-0.5 text-[10px] sm:text-xs">
                  이 질문에는 분기 로직이 포함되어 있습니다. 저장 후 다른 설문에서 사용할 때 분기
                  로직을 유지하거나 제거할 수 있습니다.
                </p>
              </div>
            </div>
          )}

          {/* 질문 이름 */}
          <div className="space-y-1.5 sm:space-y-2">
            <Label htmlFor="question-name" className="text-xs sm:text-sm">
              질문 이름 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="question-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors({ ...errors, name: undefined });
              }}
              placeholder="예: 성별 질문, 만족도 5점 척도"
              className={cn('h-9 text-sm sm:h-10', errors.name && 'border-red-300')}
            />
            {errors.name && <p className="text-[10px] text-red-500 sm:text-xs">{errors.name}</p>}
          </div>

          {/* 설명 */}
          <div className="space-y-1.5 sm:space-y-2">
            <Label htmlFor="question-description" className="text-xs sm:text-sm">
              설명 (선택)
            </Label>
            <Textarea
              id="question-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이 질문에 대한 설명을 입력하세요"
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* 카테고리 */}
          <div className="space-y-1.5 sm:space-y-2">
            <Label className="text-xs sm:text-sm">카테고리</Label>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors sm:px-3 sm:py-1.5 sm:text-sm',
                    selectedCategory === category.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300',
                  )}
                >
                  {category.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowNewCategory(true)}
                className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-600 sm:px-3 sm:py-1.5 sm:text-sm"
              >
                <Plus className="mr-0.5 inline h-3 w-3 sm:mr-1" />새 카테고리
              </button>
            </div>

            {/* 새 카테고리 입력 */}
            {showNewCategory && (
              <div className="mt-2 flex gap-1.5 sm:gap-2">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="카테고리 이름"
                  className="h-8 flex-1 text-sm sm:h-9"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCategory();
                    } else if (e.key === 'Escape') {
                      setShowNewCategory(false);
                      setNewCategoryName('');
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleAddCategory}
                  className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
                >
                  추가
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowNewCategory(false);
                    setNewCategoryName('');
                  }}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* 태그 */}
          <div className="space-y-1.5 sm:space-y-2">
            <Label className="text-xs sm:text-sm">태그</Label>
            {tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 sm:gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 sm:py-1 sm:text-sm"
                  >
                    <Tag className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-red-500"
                    >
                      <X className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 sm:gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="태그 입력 후 Enter"
                className="h-8 flex-1 text-sm sm:h-9"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddTag}
                disabled={!newTag.trim()}
                className="h-8 w-8 p-0 sm:h-9 sm:w-9"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-gray-400 sm:text-xs">
              태그를 추가하면 나중에 질문을 쉽게 찾을 수 있습니다.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-3 sm:pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm"
          >
            취소
          </Button>
          <Button onClick={handleSave} className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm">
            <Save className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
            저장
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
