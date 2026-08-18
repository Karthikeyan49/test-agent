import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { COUNTRY_CODES } from "@/lib/countryCodes";

function cleanPhoneInput(v: string) {
  return v.replace(/[^0-9]/g, "").slice(0, 15);
}

interface PhoneInputProps {
  code: string;
  number: string;
  onCodeChange: (code: string) => void;
  onNumberChange: (number: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function PhoneInput({
  code,
  number,
  onCodeChange,
  onNumberChange,
  placeholder = "Phone number",
  disabled,
}: PhoneInputProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[110px] shrink-0 justify-between px-3 font-normal bg-muted"
            disabled={disabled}
            type="button"
          >
            <span className="truncate text-sm">{code}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search country…" />
            <CommandList>
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {COUNTRY_CODES.map((c) => (
                  <CommandItem
                    key={c.code}
                    value={`${c.name} ${c.code} ${c.iso}`}
                    onSelect={() => {
                      onCodeChange(c.code);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        code === c.code ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.code}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        type="tel"
        inputMode="numeric"
        value={number}
        onChange={(e) => onNumberChange(cleanPhoneInput(e.target.value))}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1"
      />
    </div>
  );
}
