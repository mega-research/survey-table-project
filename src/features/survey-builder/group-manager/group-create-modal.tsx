'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { QuestionGroup } from '@/types/survey';

interface GroupCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  groupName: string;
  setGroupName: (name: string) => void;
  groupDescription: string;
  setGroupDescription: (description: string) => void;
  parentGroupId?: string | undefined;
  groups: QuestionGroup[];
}

export function GroupCreateModal({
  isOpen,
  onClose,
  onSubmit,
  groupName,
  setGroupName,
  groupDescription,
  setGroupDescription,
  parentGroupId,
  groups,
}: GroupCreateModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {parentGroupId
              ? `하위 그룹 만들기 (${groups.find((g) => g.id === parentGroupId)?.name})`
              : '새 그룹 만들기'}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              그룹 이름 <span className="text-red-500">*</span>
            </label>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="예: 응답자 정보, 1. TV보유 현황"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  onSubmit();
                }
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">그룹 설명 (선택)</label>
            <Textarea
              value={groupDescription}
              onChange={(e) => setGroupDescription(e.target.value)}
              placeholder="그룹에 대한 간단한 설명을 입력하세요"
              rows={3}
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button onClick={onSubmit} disabled={!groupName.trim()}>
              생성
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
