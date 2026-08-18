import { Phone, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PhoneButtonProps {
  phone: string | null | undefined;
  iconOnly?: boolean;
}

export function PhoneButton({ phone, iconOnly = false }: PhoneButtonProps) {
  if (!phone) return null;
  return (
    <Button variant="ghost" size={iconOnly ? 'icon' : 'sm'} asChild>
      <a href={`tel:${phone}`} onClick={(e) => e.stopPropagation()}>
        <Phone className="h-4 w-4" />
        {!iconOnly && <span className="ml-1">{phone}</span>}
      </a>
    </Button>
  );
}

interface WhatsAppButtonProps {
  phone: string | null | undefined;
  message?: string;
  iconOnly?: boolean;
}

export function WhatsAppButton({ phone, message = '', iconOnly = false }: WhatsAppButtonProps) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  const url = `https://wa.me/91${clean}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  return (
    <Button variant="ghost" size={iconOnly ? 'icon' : 'sm'} asChild>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        <MessageCircle className="h-4 w-4 text-green-600" />
        {!iconOnly && <span className="ml-1">WhatsApp</span>}
      </a>
    </Button>
  );
}
