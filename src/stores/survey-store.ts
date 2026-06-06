import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import { buildFlatOrderedQuestions } from '@/lib/group-ordering';
import { regenerateAfterDelete, regenerateAfterReorder } from '@/lib/spss/variable-generator';

// ── 헬퍼 함수 ──

/** 그룹 내 인터리브 자식 수를 고려한 다음 order 계산 */
function calculateNextOrder(
  groupId: string | undefined,
  questions: Question[],
  groups: QuestionGroup[],
): number {
  if (groupId) {
    const siblingQuestions = questions.filter((q) => q.groupId === groupId);
    const siblingSubGroups = groups.filter((g) => g.parentGroupId === groupId);
    const maxQOrder = siblingQuestions.length > 0
      ? Math.max(...siblingQuestions.map((q) => q.order))
      : -1;
    const maxGOrder = siblingSubGroups.length > 0
      ? Math.max(...siblingSubGroups.map((g) => g.order))
      : -1;
    return Math.max(maxQOrder, maxGOrder) + 1;
  }
  return questions.length > 0 ? Math.max(...questions.map((q) => q.order), 0) + 1 : 1;
}

/** 전체 트리를 순회하여 Question.order를 전역 순번으로 재할당 */
function recalculateGlobalOrder(questions: Question[], groups: QuestionGroup[]): void {
  const flat = buildFlatOrderedQuestions(questions, groups);
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  flat.forEach((fq, index) => {
    const q = questionMap.get(fq.id);
    if (q) q.order = index + 1;
  });
}
import { generatePrivateToken, generateSlugFromTitle } from '@/lib/survey-url';
import { generateId } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';
import {
  Question,
  QuestionGroup,
  QuestionType,
  SelectLevel,
  Survey,
  SurveySettings,
  TableColumn,
  TableRow,
} from '@/types/survey';
import type { VariableDef } from '@/components/operations/mail-template/variable-catalog';

// 질문 변경 추적을 위한 changeset
export interface QuestionChangeset {
  updated: Record<string, boolean>;  // 수정된 질문 ID
  added: Record<string, boolean>;    // 새로 추가된 질문 ID
  deleted: Record<string, boolean>;  // 삭제된 질문 ID
  reordered: boolean;                // 순서 변경 여부
}

const emptyChangeset = (): QuestionChangeset => ({
  updated: {},
  added: {},
  deleted: {},
  reordered: false,
});

export interface SurveyBuilderState {
  // 현재 편집 중인 설문 (메모리에만 유지, TanStack Query로 서버와 동기화)
  currentSurvey: Survey;
  isDirty: boolean; // 변경사항 있음 표시
  isModifiedSincePublish: boolean; // 배포 후 수정되었는지

  // DB 저장 여부 (CREATE 페이지에서 서버 액션 호출 전 설문 존재 보장용)
  isSavedToDb: boolean;

  // Diff 기반 저장을 위한 changeset
  questionChanges: QuestionChangeset;
  isMetadataDirty: boolean; // 설문 메타데이터/그룹 변경 여부

  // 서버에서 불러온 데이터 설정
  setSurvey: (survey: Survey) => void;
  // 현재 surveyId 로 다시 fetch 해서 currentSurvey 를 갱신.
  // LUT 보관함에서 upsert 한 직후처럼, 외부 변경 사항을 빌더에 즉시 반영할 때 호출.
  refetchSurvey: () => Promise<void>;
  markPublished: () => void; // 배포 완료 후 호출

  // 액션들
  updateSurveyTitle: (title: string, autoUpdateSlug?: boolean) => void;
  updateSurveyDescription: (description: string) => void;

  // URL 관련 액션들
  updateSurveySlug: (slug: string) => void;
  updatePrivateToken: (token: string) => void;
  regeneratePrivateToken: () => string;

  // 그룹 관리
  addGroup: (name: string, description?: string, parentGroupId?: string) => void;
  updateGroup: (groupId: string, updates: Partial<QuestionGroup>) => void;
  deleteGroup: (groupId: string) => void;
  reorderGroups: (groupIds: string[]) => void;
  reorderGroupChildren: (parentGroupId: string, items: Array<{ kind: 'question' | 'subgroup'; id: string }>) => void;
  toggleGroupCollapse: (groupId: string) => void;

  addQuestion: (type: QuestionType, groupId?: string) => void;
  addPreparedQuestion: (question: Question) => void;
  updateQuestion: (questionId: string, updates: Partial<Question>) => void;
  deleteQuestion: (questionId: string) => void;
  reorderQuestions: (questionIds: string[]) => void;

  updateSurveySettings: (settings: Partial<SurveySettings>) => void;
  updateContactEmail: (email: string | null) => void;

  // 초기화
  resetSurvey: () => void;
  markClean: () => void; // 저장 후 dirty 플래그 초기화
  markSavedToDb: () => void; // DB에 설문 레코드 생성 완료 마킹

  // Diff 저장용 changeset 관리
  snapshotChanges: () => { questionChanges: QuestionChangeset; isMetadataDirty: boolean };
  mergeChangesBack: (snapshot: { questionChanges: QuestionChangeset; isMetadataDirty: boolean }) => void;

  // 현재 편집 중인 질문 ID (모달 open/close 시 설정)
  editingQuestionId: string | null;
  setEditingQuestionId: (id: string | null) => void;
  // dirty/questionChanges를 건드리지 않는 질문 업데이트 (UI 전용 토글 등)
  silentUpdateQuestion: (questionId: string, updates: Partial<Question>) => void;

  // 설문 변수 카탈로그 (prefill {{attrs_key}} 토큰용)
  variableCatalog: VariableDef[];
  setVariableCatalog: (catalog: VariableDef[]) => void;
}

const defaultSurveySettings: SurveySettings = {
  isPublic: true,
  allowMultipleResponses: false,
  showProgressBar: true,
  shuffleQuestions: false,
  requireLogin: false,
  thankYouMessage: '응답해주셔서 감사합니다!',
};

const createDefaultSurvey = (): Survey => ({
  id: generateId(),
  title: '새 설문조사',
  description: '',
  slug: '',
  privateToken: generatePrivateToken(),
  groups: [],
  questions: [],
  lookups: [],
  settings: defaultSurveySettings,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const withDevtools = process.env.NODE_ENV === 'development'
  ? <T,>(fn: T) => devtools(fn as any, { name: 'survey-builder-store' })
  : <T,>(fn: T) => fn;

export const useSurveyBuilderStore = create<SurveyBuilderState>()(
  withDevtools(
    immer<SurveyBuilderState>((set, get) => ({
      currentSurvey: createDefaultSurvey(),
      isDirty: false,
      isSavedToDb: false,
      isModifiedSincePublish: false,
      questionChanges: emptyChangeset(),
      isMetadataDirty: false,
      editingQuestionId: null,
      variableCatalog: [],

      // 서버에서 불러온 설문 데이터 설정
      setSurvey: (survey: Survey) =>
        set((state) => {
          state.currentSurvey = survey;

          state.isDirty = false;
          state.isSavedToDb = true;
          state.isModifiedSincePublish = false;
          state.questionChanges = emptyChangeset();
          state.isMetadataDirty = false;
        }),

      // surveyId 로 서버에서 다시 fetch 해서 setSurvey 까지 수행.
      // 다른 server action 으로 currentSurvey 의 jsonb 필드(lookups 등)가 외부 변경됐을 때 사용.
      refetchSurvey: async () => {
        const surveyId = get().currentSurvey.id;
        if (!surveyId) return;
        const fresh = await client.surveyBuilder.read.withDetails({ surveyId });
        if (fresh) {
          set((state) => {
            // 빌더 dirty 상태와 changeset 은 보존 — refetch 는 단일 jsonb 갱신용이므로
            // setSurvey 의 전체 reset 동작을 의도적으로 피한다.
            state.currentSurvey = fresh;
          });
        }
      },

      markPublished: () =>
        set((state) => {
          state.currentSurvey.status = 'published';
          state.isModifiedSincePublish = false;
        }),

      updateSurveyTitle: (title: string, autoUpdateSlug: boolean = false) =>
        set((state) => {
          state.currentSurvey.title = title;
          state.currentSurvey.updatedAt = new Date();

          if (autoUpdateSlug && state.currentSurvey.settings.isPublic) {
            state.currentSurvey.slug = generateSlugFromTitle(title);
          }
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      updateSurveyDescription: (description: string) =>
        set((state) => {
          state.currentSurvey.description = description;
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      updateSurveySlug: (slug: string) =>
        set((state) => {
          state.currentSurvey.slug = slug;
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      updatePrivateToken: (token: string) =>
        set((state) => {
          state.currentSurvey.privateToken = token;
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      regeneratePrivateToken: () => {
        const newToken = generatePrivateToken();
        set((state) => {
          state.currentSurvey.privateToken = newToken;
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        });
        return newToken;
      },

      addGroup: (name: string, description?: string, parentGroupId?: string) => {
        const groups = get().currentSurvey.groups || [];
        const questions = get().currentSurvey.questions;

        // 같은 부모 그룹 내 질문 + 형제그룹의 통합 order 공간에서 maxOrder 계산
        const siblingGroups = groups.filter((g) => g.parentGroupId === parentGroupId);
        const siblingQuestions = parentGroupId
          ? questions.filter((q) => q.groupId === parentGroupId)
          : [];
        const allOrders = [
          ...siblingGroups.map((g) => g.order),
          ...siblingQuestions.map(() => 0), // 질문 수만큼 슬롯 차지
        ];
        const maxOrder = allOrders.length > 0
          ? siblingGroups.length + siblingQuestions.length - 1
          : -1;

        const newGroup: QuestionGroup = {
          id: generateId(),
          surveyId: get().currentSurvey.id,
          name,
          ...(description !== undefined ? { description } : {}),
          ...(parentGroupId !== undefined ? { parentGroupId } : {}),
          order: maxOrder + 1,
          collapsed: false,
        };

        set((state) => {
          if (!state.currentSurvey.groups) {
            state.currentSurvey.groups = [];
          }
          state.currentSurvey.groups.push(newGroup);
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        });
      },

      updateGroup: (groupId: string, updates: Partial<QuestionGroup>) =>
        set((state) => {
          const group = state.currentSurvey.groups?.find((g) => g.id === groupId);
          if (group) {
            Object.assign(group, updates);
            state.currentSurvey.updatedAt = new Date();
            state.isDirty = true;
            state.isMetadataDirty = true;
            if (state.currentSurvey.status === 'published') {
              state.isModifiedSincePublish = true;
            }
          }
        }),

      deleteGroup: (groupId: string) =>
        set((state) => {
          const groups = state.currentSurvey.groups || [];
          const groupsToDelete = new Set([groupId]);

          const findChildGroups = (parentId: string) => {
            groups.forEach((g) => {
              if (g.parentGroupId === parentId) {
                groupsToDelete.add(g.id);
                findChildGroups(g.id);
              }
            });
          };
          findChildGroups(groupId);

          state.currentSurvey.groups = groups.filter((g) => !groupsToDelete.has(g.id));

          // 그룹 삭제 시 소속 질문들의 groupId도 변경됨 → updated 추가
          state.currentSurvey.questions.forEach((q) => {
            if (q.groupId && groupsToDelete.has(q.groupId)) {
              delete q.groupId;
              if (!state.questionChanges.added[q.id]) {
                state.questionChanges.updated[q.id] = true;
              }
            }
          });

          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      reorderGroups: (groupIds: string[]) =>
        set((state) => {
          if (!state.currentSurvey.groups) return;

          const groups = state.currentSurvey.groups;
          const groupMap = new Map<string, QuestionGroup>(groups.map((g) => [g.id, g]));

          const topLevelGroups: QuestionGroup[] = [];

          // 1. groupIds에 있는 그룹들을 순서대로 재배치하고 order 업데이트
          groupIds.forEach((id, index) => {
            const g = groupMap.get(id);
            if (g) {
              g.order = index;
              topLevelGroups.push(g);
              groupMap.delete(id); // 처리된 그룹 제거
            }
          });

          // 2. 남은 그룹들 (하위 그룹이거나, groupIds에 포함되지 않은 상위 그룹 등)
          const remainingGroups = Array.from(groupMap.values());

          // 합치기
          state.currentSurvey.groups = [...topLevelGroups, ...remainingGroups];
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      reorderGroupChildren: (_parentGroupId: string, items: Array<{ kind: 'question' | 'subgroup'; id: string }>) =>
        set((state) => {
          const oldCodes = new Map(state.currentSurvey.questions.map((q) => [q.id, q.questionCode]));
          const groups = state.currentSurvey.groups || [];

          // 1. 질문과 하위그룹 모두에 인터리브 위치(order) 할당
          items.forEach((item, index) => {
            if (item.kind === 'subgroup') {
              const group = groups.find((g) => g.id === item.id);
              if (group) group.order = index;
            } else {
              const question = state.currentSurvey.questions.find((q) => q.id === item.id);
              if (question) question.order = index;
            }
          });

          // 2. 전체 트리 순회하여 전역 Question.order 재계산
          recalculateGlobalOrder(state.currentSurvey.questions, groups);

          state.currentSurvey.questions = regenerateAfterReorder(state.currentSurvey.questions);

          // 3. changeset 업데이트
          state.questionChanges.reordered = true;
          state.isMetadataDirty = true;
          markSpssChangedQuestions(state, oldCodes);

          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      toggleGroupCollapse: (groupId: string) =>
        set((state) => {
          const group = state.currentSurvey.groups?.find((g) => g.id === groupId);
          if (group) {
            group.collapsed = !group.collapsed;
            state.isDirty = true;
            state.isMetadataDirty = true;
          }
        }),

      addQuestion: (type: QuestionType, groupId?: string) => {
        const questions = get().currentSurvey.questions;
        const groups = get().currentSurvey.groups || [];

        const newQuestion: Question = {
          id: generateId(),
          type,
          title: getDefaultQuestionTitle(type),
          required: false,
          order: calculateNextOrder(groupId, questions, groups),
          ...(groupId !== undefined ? { groupId } : {}),
          ...(needsOptions(type) && {
            options: [
              { id: generateId(), label: '옵션 1', value: '옵션1', spssNumericCode: 1 },
              { id: generateId(), label: '옵션 2', value: '옵션2', spssNumericCode: 2 },
            ],
          }),
          ...(needsSelectLevels(type) && { selectLevels: getDefaultSelectLevels() }),
          ...(needsTableData(type) && {
            tableTitle: '',
            tableColumns: getDefaultTableColumns(),
            tableRowsData: getDefaultTableRows(),
          }),
        };

        set((state) => {
          // SPSS 재생성 전 코드 스냅샷
          const oldCodes = new Map(state.currentSurvey.questions.map((q) => [q.id, q.questionCode]));

          state.currentSurvey.questions.push(newQuestion);

          // 그룹 내 추가 시 전역 order 재계산
          if (groupId) {
            recalculateGlobalOrder(state.currentSurvey.questions, state.currentSurvey.groups || []);
          }

          state.currentSurvey.questions = regenerateAfterReorder(
            state.currentSurvey.questions,
          );

          // changeset: 새 질문 추가
          state.questionChanges.added[newQuestion.id] = true;
          // SPSS 코드가 바뀐 기존 질문들도 updated에 추가
          markSpssChangedQuestions(state, oldCodes);

          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        });
      },

      addPreparedQuestion: (question: Question) => {
        const questions = get().currentSurvey.questions;
        const groups = get().currentSurvey.groups || [];

        const questionWithOrder = {
          ...question,
          order: calculateNextOrder(question.groupId, questions, groups),
        };

        set((state) => {
          const oldCodes = new Map(state.currentSurvey.questions.map((q) => [q.id, q.questionCode]));

          state.currentSurvey.questions.push(questionWithOrder);

          // 그룹 내 추가 시 전역 order 재계산
          if (question.groupId) {
            recalculateGlobalOrder(state.currentSurvey.questions, state.currentSurvey.groups || []);
          }

          state.currentSurvey.questions = regenerateAfterReorder(
            state.currentSurvey.questions,
          );

          state.questionChanges.added[questionWithOrder.id] = true;
          markSpssChangedQuestions(state, oldCodes);

          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        });
      },

      updateQuestion: (questionId: string, updates: Partial<Question>) =>
        set((state) => {
          const question = state.currentSurvey.questions.find((q) => q.id === questionId);
          if (question) {
            Object.assign(question, updates);
            state.currentSurvey.updatedAt = new Date();
            state.isDirty = true;
            // added에 없는 질문만 updated에 추가 (added면 이미 전체 전송 대상)
            if (!state.questionChanges.added[questionId]) {
              state.questionChanges.updated[questionId] = true;
            }
            if (state.currentSurvey.status === 'published') {
              state.isModifiedSincePublish = true;
            }
          }
        }),

      deleteQuestion: (questionId: string) =>
        set((state) => {
          const oldCodes = new Map(state.currentSurvey.questions.map((q) => [q.id, q.questionCode]));
          const deletedQuestion = state.currentSurvey.questions.find((q) => q.id === questionId);

          state.currentSurvey.questions = state.currentSurvey.questions.filter(
            (q) => q.id !== questionId,
          );

          // 그룹 내 삭제 시 전역 order 재계산 (인터리브 순서 유지)
          if (deletedQuestion?.groupId) {
            recalculateGlobalOrder(state.currentSurvey.questions, state.currentSurvey.groups || []);
          }

          state.currentSurvey.questions = regenerateAfterDelete(
            state.currentSurvey.questions,
          );

          // changeset: 삭제 처리
          if (state.questionChanges.added[questionId]) {
            // 추가 후 삭제 → 서버에 보낼 필요 없음
            delete state.questionChanges.added[questionId];
          } else {
            state.questionChanges.deleted[questionId] = true;
          }
          delete state.questionChanges.updated[questionId];

          // SPSS 코드가 바뀐 기존 질문들도 updated에 추가
          markSpssChangedQuestions(state, oldCodes);

          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      reorderQuestions: (questionIds: string[]) =>
        set((state) => {
          const oldCodes = new Map(state.currentSurvey.questions.map((q) => [q.id, q.questionCode]));
          const questions = state.currentSurvey.questions;
          const questionMap = new Map<string, Question>(questions.map((q) => [q.id, q]));

          const reorderedQuestions: Question[] = [];

          questionIds.forEach((id, index) => {
            const q = questionMap.get(id);
            if (q) {
              q.order = index + 1;
              reorderedQuestions.push(q);
              questionMap.delete(id);
            }
          });

          // 남은 질문들 추가 (혹시 모를 누락 방지)
          Array.from(questionMap.values()).forEach((q) => reorderedQuestions.push(q));

          state.currentSurvey.questions = regenerateAfterReorder(reorderedQuestions);

          // changeset: 순서 변경 + SPSS 코드 변경된 질문 추적
          state.questionChanges.reordered = true;
          markSpssChangedQuestions(state, oldCodes);

          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      updateSurveySettings: (settings: Partial<SurveySettings>) =>
        set((state) => {
          Object.assign(state.currentSurvey.settings, settings);
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      updateContactEmail: (email: string | null) =>
        set((state) => {
          state.currentSurvey.contactEmail = email;
          state.currentSurvey.updatedAt = new Date();
          state.isDirty = true;
          state.isMetadataDirty = true;
          if (state.currentSurvey.status === 'published') {
            state.isModifiedSincePublish = true;
          }
        }),

      resetSurvey: () =>
        set((state) => {
          state.currentSurvey = createDefaultSurvey();
          state.isDirty = false;
          state.isSavedToDb = false;
          state.isModifiedSincePublish = false;
          state.questionChanges = emptyChangeset();
          state.isMetadataDirty = false;
        }),

      markClean: () =>
        set((state) => {
          state.isDirty = false;
          state.questionChanges = emptyChangeset();
          state.isMetadataDirty = false;
        }),

      markSavedToDb: () =>
        set((state) => {
          state.isSavedToDb = true;
        }),

      // 저장 시작 시 changeset 스냅샷 후 초기화 (저장 중 새 변경은 새 changeset에 쌓임)
      snapshotChanges: () => {
        const state = get();
        const snapshot = {
          questionChanges: { ...state.questionChanges },
          isMetadataDirty: state.isMetadataDirty,
        };
        set((s) => {
          s.questionChanges = emptyChangeset();
          s.isMetadataDirty = false;
        });
        return snapshot;
      },

      // 저장 실패 시 스냅샷을 현재 changeset에 merge back
      mergeChangesBack: (snapshot: { questionChanges: QuestionChangeset; isMetadataDirty: boolean }) => {
        set((state) => {
          const pending = snapshot.questionChanges;
          const current = state.questionChanges;

          // pending.added → current에 merge (단, current에서 삭제된 건 제외)
          for (const id in pending.added) {
            if (!current.deleted[id]) {
              current.added[id] = true;
            }
          }
          // pending.updated → current에 merge (삭제/추가 대상 제외)
          for (const id in pending.updated) {
            if (!current.deleted[id] && !current.added[id]) {
              current.updated[id] = true;
            }
          }
          // pending.deleted → current에 merge
          for (const id in pending.deleted) {
            if (current.added[id]) {
              // 저장 중 다시 추가된 경우 → 상쇄
              delete current.added[id];
            } else {
              current.deleted[id] = true;
            }
            delete current.updated[id];
          }

          if (pending.reordered) {
            current.reordered = true;
          }
          if (snapshot.isMetadataDirty) {
            state.isMetadataDirty = true;
          }

          // isDirty도 복원
          state.isDirty = true;
        });
      },

      // 현재 편집 중인 질문 ID
      setEditingQuestionId: (id: string | null) => {
        set((state) => {
          state.editingQuestionId = id;
        });
      },

      // dirty/questionChanges를 건드리지 않는 질문 업데이트 (UI 전용 토글 등)
      silentUpdateQuestion: (questionId: string, updates: Partial<Question>) => {
        set((state) => {
          const question = state.currentSurvey.questions.find((q) => q.id === questionId);
          if (question) Object.assign(question, updates);
        });
      },

      // 설문 변수 카탈로그 설정 (prefill 토큰용)
      setVariableCatalog: (catalog: VariableDef[]) => {
        set((state) => {
          state.variableCatalog = catalog;
        });
      },
    })) as any,
  ) as any,
);

/**
 * SPSS 코드 재생성 후 코드가 바뀐 기존 질문들을 updated changeset에 추가.
 * added 상태인 질문은 이미 전체 전송 대상이므로 제외.
 */
function markSpssChangedQuestions(
  state: SurveyBuilderState,
  oldCodes: Map<string, string | undefined>,
) {
  for (const q of state.currentSurvey.questions) {
    if (state.questionChanges.added[q.id]) continue;
    if (oldCodes.get(q.id) !== q.questionCode) {
      state.questionChanges.updated[q.id] = true;
    }
  }
}

function getDefaultQuestionTitle(type: QuestionType): string {
  const titles: Record<QuestionType, string> = {
    text: '단답형 질문',
    textarea: '장문형 질문',
    radio: '단일 선택 질문',
    checkbox: '다중 선택 질문',
    select: '드롭다운 질문',
    multiselect: '다중 드롭다운 질문',
    ranking: '순위형 질문',
    table: '테이블 질문',
    notice: '공지사항',
  };
  return titles[type];
}

function needsOptions(type: QuestionType): boolean {
  return ['radio', 'checkbox', 'select', 'ranking'].includes(type);
}

function needsSelectLevels(type: QuestionType): boolean {
  return type === 'multiselect';
}

function needsTableData(type: QuestionType): boolean {
  return type === 'table';
}

function getDefaultSelectLevels(): SelectLevel[] {
  const level1Id = generateId();
  const level2Id = generateId();
  return [
    {
      id: level1Id,
      label: '음식종류',
      placeholder: '음식종류를 선택하세요',
      order: 0,
      options: [
        { id: generateId(), label: '한식', value: '한식', spssNumericCode: 1 },
        { id: generateId(), label: '중식', value: '중식', spssNumericCode: 2 },
        { id: generateId(), label: '양식', value: '양식', spssNumericCode: 3 },
      ],
    },
    {
      id: level2Id,
      label: '메뉴',
      placeholder: '메뉴를 선택하세요',
      order: 1,
      options: [
        { id: generateId(), label: '김치찌개', value: '한식-김치찌개', spssNumericCode: 1 },
        { id: generateId(), label: '불고기', value: '한식-불고기', spssNumericCode: 2 },
        { id: generateId(), label: '비빔밥', value: '한식-비빔밥', spssNumericCode: 3 },
        { id: generateId(), label: '짜장면', value: '중식-짜장면', spssNumericCode: 4 },
        { id: generateId(), label: '짬뽕', value: '중식-짬뽕', spssNumericCode: 5 },
        { id: generateId(), label: '탕수육', value: '중식-탕수육', spssNumericCode: 6 },
        { id: generateId(), label: '스테이크', value: '양식-스테이크', spssNumericCode: 7 },
        { id: generateId(), label: '파스타', value: '양식-파스타', spssNumericCode: 8 },
        { id: generateId(), label: '피자', value: '양식-피자', spssNumericCode: 9 },
      ],
    },
  ];
}

function getDefaultTableColumns(): TableColumn[] {
  return [
    { id: generateId(), label: '매우 좋음' },
    { id: generateId(), label: '좋음' },
    { id: generateId(), label: '보통' },
    { id: generateId(), label: '나쁨' },
  ];
}

function getDefaultTableRows(): TableRow[] {
  const row1Id = generateId();
  const row2Id = generateId();
  return [
    {
      id: row1Id,
      label: '행 1',
      height: 60,
      minHeight: 40,
      cells: [
        { id: generateId(), content: '', type: 'text' },
        { id: generateId(), content: '', type: 'text' },
        { id: generateId(), content: '', type: 'text' },
        { id: generateId(), content: '', type: 'text' },
      ],
    },
    {
      id: row2Id,
      label: '행 2',
      height: 60,
      minHeight: 40,
      cells: [
        { id: generateId(), content: '', type: 'text' },
        { id: generateId(), content: '', type: 'text' },
        { id: generateId(), content: '', type: 'text' },
        { id: generateId(), content: '', type: 'text' },
      ],
    },
  ];
}
