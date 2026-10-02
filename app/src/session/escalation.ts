/**
 * Mensaje al contacto de confianza. Humano en el bucle: Kairos solo ARMA el enlace; el
 * usuario lo abre y es el usuario quien pulsa "enviar" en WhatsApp o en SMS.
 * El mensaje es neutro y no lleva datos fisiológicos.
 */

export type Channel = 'whatsapp' | 'sms';

export interface TrustedContact {
  name: string;
  phone: string;
  channel: Channel;
}

/** Reemplaza {nombre}. */
export function renderMessage(template: string, userName: string): string {
  return template.replaceAll('{nombre}', userName.trim() || 'yo').trim();
}

/**
 * Normaliza a formato internacional sin "+" (lo que pide wa.me). Ecuador por defecto:
 * 0991234567 -> 593991234567. Devuelve null si no parece un teléfono.
 */
export function normalizePhone(raw: string, defaultCountry = '593'): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return defaultCountry + digits.slice(1);
  if (digits.startsWith(defaultCountry) && digits.length >= 11) return digits;
  return defaultCountry + digits;
}

export function escalationUrl(contact: TrustedContact, message: string): string | null {
  const phone = normalizePhone(contact.phone);
  if (!phone) return null;
  const text = encodeURIComponent(message);
  return contact.channel === 'whatsapp' ? `https://wa.me/${phone}?text=${text}` : `sms:+${phone}?&body=${text}`;
}

/**
 * Intenta abrir el enlace. Devuelve false si el navegador lo bloqueó (pasa cuando no hubo
 * un gesto del usuario); la UI entonces muestra un botón para abrirlo a mano.
 */
export function openLink(url: string): boolean {
  if (url.startsWith('sms:')) {
    try {
      window.location.href = url;
      return true;
    } catch {
      return false;
    }
  }
  // sin 'noopener' en las features: con él, window.open devuelve null siempre y no
  // sabríamos si se bloqueó. Cortamos el opener a mano.
  const w = window.open(url, '_blank');
  if (!w) return false;
  w.opener = null;
  return true;
}
