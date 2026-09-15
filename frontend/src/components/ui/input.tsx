import * as React from 'react';
import { cn } from '../../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground',
          'transition-[border-color,box-shadow] duration-fast ease-out',
          'placeholder:text-subtle-foreground',
          'hover:border-neutral-300',
          'focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input',
          'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_rgb(220_38_38_/_0.25)]',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
