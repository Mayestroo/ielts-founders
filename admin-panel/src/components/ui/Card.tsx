'use client';

import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = '', hover = false }: CardProps) {
  return (
    <div className={`
      bg-white dark:bg-slate-900/80 rounded-2xl shadow-sm 
      border border-slate-200 dark:border-slate-800
      ${hover ? 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md' : ''}
      ${className}
    `}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-4 border-b border-slate-200/70 dark:border-slate-800 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-4 border-t border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 rounded-b-2xl ${className}`}>
      {children}
    </div>
  );
}
