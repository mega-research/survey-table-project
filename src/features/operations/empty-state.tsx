import { cn } from '@/lib/utils';

interface Props {
  message: string;
  description?: string;
  className?: string;
}

export function EmptyState({ message, description, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <p className="text-sm font-medium text-slate-500">{message}</p>
      {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
    </div>
  );
}
