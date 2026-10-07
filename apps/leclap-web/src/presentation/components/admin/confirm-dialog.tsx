import type { ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/presentation/components/ui';
import { useReturnFocus } from './use-return-focus';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  // `danger` for what can't be undone (templates and partials only live in this browser); the
  // destructive action is then the only red control in view.
  tone?: 'danger' | 'primary';
  // Where focus goes when the opener is gone: a confirmed delete removes (or disables) the control
  // that opened the dialog. Otherwise focus returns to that control.
  focusFallback?: () => HTMLElement | null;
  // Extra content between the question and the buttons (e.g. a "remember this" checkbox).
  children?: ReactNode;
  // Shown over an open sheet (the browser agent's drawer), which its scrim then dims too.
  raised?: boolean;
}

// A yes/no question before an action that changes the library. Cancel comes first in the DOM, so it
// takes the dialog's initial focus and Enter never confirms by accident.
export const ConfirmDialog = ({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  onCancel,
  tone = 'danger',
  focusFallback,
  children,
  raised = false,
}: ConfirmDialogProps) => {
  const returnFocus = useReturnFocus(focusFallback);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md" raised={raised} {...returnFocus}>
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
