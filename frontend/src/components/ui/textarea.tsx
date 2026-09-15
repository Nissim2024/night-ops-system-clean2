import * as React from 'react';
import { cn } from '../../lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground',
          'transition-[border-color,box-shadow] duration-fast ease-out',
          'placeholder:text-subtle-foreground',
          'hover:border-neutral-300',
          'focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input',
          'aria-[invalid=true]:border-danger',
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
