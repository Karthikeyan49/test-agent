import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ComponentPropsWithoutRef } from 'react';

interface SearchInputProps extends Omit<ComponentPropsWithoutRef<typeof Input>, 'className'> {
  placeholder?: string;
  containerClassName?: string;
}

export function SearchInput({
  placeholder = 'Search…',
  containerClassName,
  ...props
}: SearchInputProps) {
  return (
    <div className={`relative ${containerClassName ?? 'w-52'}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input className="pl-9" placeholder={placeholder} {...props} />
    </div>
  );
}

export default SearchInput;
