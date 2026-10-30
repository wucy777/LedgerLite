import type { CSSProperties } from 'react';
import type { Category } from '@shared/types';
import { Icon } from './Icon';

interface CategoryGlyphProps {
  category: Pick<Category, 'name' | 'icon' | 'color'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CategoryGlyph({ category, size = 'md', className = '' }: CategoryGlyphProps) {
  return (
    <span
      className={`category-glyph category-glyph--${size} ${className}`.trim()}
      style={{ '--glyph-color': category.color } as CSSProperties}
      aria-hidden="true"
    >
      <Icon name={category.icon} size={size === 'lg' ? 24 : size === 'sm' ? 16 : 20} strokeWidth={1.7} />
    </span>
  );
}
