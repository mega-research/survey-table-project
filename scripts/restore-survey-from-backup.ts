import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/db';
import {
  surveys,
  questions as questionsTable,
  questionGroups,
  surveyResponses,
  NewSurvey,
  NewQuestion,
  NewQuestionGroup,
  NewSurveyResponse,
} from '@/db/schema';
import { eq } from 'drizzle-orm';

interface BackupData {
  backupDate: string;
  survey: {
    id: string;
    title: string;
    description?: string;
    slug?: string;
    privateToken?: string;
    settings?: {
      isPublic?: boolean;
      allowMultipleResponses?: boolean;
      showProgressBar?: boolean;
      shuffleQuestions?: boolean;
      requireLogin?: boolean;
      endDate?: string;
      maxResponses?: number;
      thankYouMessage?: string;
    };
    createdAt?: string;
    updatedAt?: string;
    groups?: Array<{
    id: string;
    name: string;
    description?: string;
    order: number;
    parentGroupId?: string;
    color?: string;
    collapsed?: boolean;
    displayCondition?: unknown;
    }>;
    questions?: Array<{
    id: string;
    type: string;
    title: string;
    description?: string;
    required?: boolean;
    order: number;
    groupId?: string;
    options?: unknown;
    selectLevels?: unknown;
    tableTitle?: string;
    tableColumns?: unknown;
    tableRowsData?: unknown;
    imageUrl?: string;
    videoUrl?: string;
    allowOtherOption?: boolean;
    minSelections?: number;
    maxSelections?: number;
    noticeContent?: string;
    requiresAcknowledgment?: boolean;
    placeholder?: string;
    tableValidationRules?: unknown;
    displayCondition?: unknown;
    }>;
  };
  responses?: Array<{
    id: string;
    surveyId: string;
    questionResponses: Record<string, unknown>;
    isCompleted?: boolean;
    startedAt?: string;
    completedAt?: string;
    userAgent?: string;
    ipAddress?: string;
    sessionId?: string;
    createdAt?: string;
  }>;
}

async function restoreSurveyFromBackup(backupFilePath: string) {
  console.log('백업 파일 읽는 중...');
  const backupContent = readFileSync(backupFilePath, 'utf-8');
  const backupData: BackupData = JSON.parse(backupContent);

  const surveyData = backupData.survey;
  const surveyId = surveyData.id;

  console.log(`\n설문 복원 시작: "${surveyData.title}" (ID: ${surveyId})`);

  // 기존 설문 확인
  const existingSurvey = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
  });

  if (existingSurvey) {
    console.log('기존 설문 발견. 삭제 중...');
    // Cascade 삭제로 그룹, 질문, 응답도 함께 삭제됨
    await db.delete(surveys).where(eq(surveys.id, surveyId));
    console.log('기존 설문 삭제 완료');
  }

  // 설문 생성
  console.log('설문 생성 중...');
  const newSurvey: NewSurvey = {
    id: surveyId,
    title: surveyData.title,
    description: surveyData.description || null,
    slug: surveyData.slug || null,
    privateToken: surveyData.privateToken || undefined,
    isPublic: surveyData.settings?.isPublic ?? true,
    allowMultipleResponses: surveyData.settings?.allowMultipleResponses ?? false,
    showProgressBar: surveyData.settings?.showProgressBar ?? true,
    shuffleQuestions: surveyData.settings?.shuffleQuestions ?? false,
    requireLogin: surveyData.settings?.requireLogin ?? false,
    endDate: surveyData.settings?.endDate ? new Date(surveyData.settings.endDate) : null,
    maxResponses: surveyData.settings?.maxResponses ?? null,
    thankYouMessage: surveyData.settings?.thankYouMessage || '응답해주셔서 감사합니다!',
  };

  await db.insert(surveys).values(newSurvey);
  console.log('설문 생성 완료');

  // 그룹 생성 (상위 그룹부터 하위 그룹 순으로 정렬)
  const groups = surveyData.groups || [];
  if (groups.length > 0) {
    console.log(`\n질문 그룹 ${groups.length}개 생성 중...`);

    // 그룹을 상위 그룹부터 하위 그룹 순으로 정렬
    const sortedGroups: typeof groups = [];
    const processedGroupIds = new Set<string>();

    // 최상위 그룹들 (parentGroupId가 없음)을 order 순으로 정렬하여 추가
    const topLevelGroups = groups
      .filter((g) => !g.parentGroupId)
      .sort((a, b) => a.order - b.order);
    sortedGroups.push(...topLevelGroups);
    topLevelGroups.forEach((g) => processedGroupIds.add(g.id));

    // 하위 그룹들을 재귀적으로 추가
    const addSubGroups = (parentId: string) => {
      const subGroups = groups
        .filter((g) => g.parentGroupId === parentId && !processedGroupIds.has(g.id))
        .sort((a, b) => a.order - b.order);

      subGroups.forEach((g) => {
        sortedGroups.push(g);
        processedGroupIds.add(g.id);
        // 재귀적으로 하위 그룹 추가
        addSubGroups(g.id);
      });
    };

    // 각 최상위 그룹의 하위 그룹들을 추가
    topLevelGroups.forEach((group) => {
      addSubGroups(group.id);
    });

    // 정렬된 순서대로 그룹 저장
    for (const group of sortedGroups) {
      const newGroup: NewQuestionGroup = {
        id: group.id,
        surveyId,
        name: group.name,
        description: group.description || null,
        order: group.order,
        parentGroupId: group.parentGroupId || null,
        color: group.color || null,
        collapsed: group.collapsed ?? false,
        displayCondition: group.displayCondition as NewQuestionGroup['displayCondition'],
      };

      await db.insert(questionGroups).values(newGroup);
    }
    console.log('질문 그룹 생성 완료');
  }

  // 질문 생성
  const questions = surveyData.questions || [];
  if (questions.length > 0) {
    console.log(`\n질문 ${questions.length}개 생성 중...`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      
      // 유효성 검사
      if (!question || !question.id || !question.type || !question.title) {
        console.error(`질문 ${i + 1}번째 항목이 유효하지 않습니다:`, question);
        errorCount++;
        continue;
      }

      try {
        const newQuestion: NewQuestion = {
          id: question.id,
          surveyId,
          groupId: question.groupId || null,
          type: question.type,
          title: question.title,
          description: question.description || null,
          required: question.required ?? false,
          order: question.order ?? i,
          options: (question.options || null) as NewQuestion['options'],
          selectLevels: (question.selectLevels || null) as NewQuestion['selectLevels'],
          tableTitle: question.tableTitle || null,
          tableColumns: (question.tableColumns || null) as NewQuestion['tableColumns'],
          tableRowsData: (question.tableRowsData || null) as NewQuestion['tableRowsData'],
          imageUrl: question.imageUrl || null,
          videoUrl: question.videoUrl || null,
          allowOtherOption: question.allowOtherOption ?? false,
          minSelections: question.minSelections || null,
          maxSelections: question.maxSelections || null,
          noticeContent: question.noticeContent || null,
          requiresAcknowledgment: question.requiresAcknowledgment ?? false,
          placeholder: question.placeholder || null,
          tableValidationRules: (question.tableValidationRules || null) as NewQuestion['tableValidationRules'],
          displayCondition: (question.displayCondition || null) as NewQuestion['displayCondition'],
        };

        await db.insert(questionsTable).values(newQuestion);
        successCount++;
      } catch (error) {
        console.error(`질문 생성 실패 (${i + 1}/${questions.length}):`, question.id, question.title);
        console.error('오류:', error);
        errorCount++;
      }
    }
    
    console.log(`질문 생성 완료: 성공 ${successCount}개, 실패 ${errorCount}개`);
  }

  // 응답 생성 (있는 경우)
  if (backupData.responses && backupData.responses.length > 0) {
    console.log(`\n응답 ${backupData.responses.length}개 복원 중...`);

    for (const response of backupData.responses) {
      const newResponse: NewSurveyResponse = {
        id: response.id,
        surveyId: response.surveyId,
        questionResponses: response.questionResponses,
        isCompleted: response.isCompleted ?? false,
        startedAt: response.startedAt ? new Date(response.startedAt) : new Date(),
        completedAt: response.completedAt ? new Date(response.completedAt) : null,
        userAgent: response.userAgent || null,
        // ipAddress 컬럼 제거됨 — Task 10에서 ip_hash 기반으로 대체
        sessionId: response.sessionId || null,
      };

      await db.insert(surveyResponses).values(newResponse);
    }
    console.log('응답 복원 완료');
  }

  console.log(`\n✅ 설문 복원 완료: "${surveyData.title}"`);
  console.log(`   - 설문 ID: ${surveyId}`);
  console.log(`   - 그룹: ${groups.length}개`);
  console.log(`   - 질문: ${questions.length}개`);
  console.log(`   - 응답: ${backupData.responses?.length || 0}개`);
}

// 스크립트 실행
const backupFilePath = join(
  process.cwd(),
  'backups',
  'survey-backup-2026-01-09T16-55-03-153Z.json'
);

restoreSurveyFromBackup(backupFilePath)
  .then(() => {
    console.log('\n✅ 모든 작업 완료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 오류 발생:', error);
    process.exit(1);
  });
