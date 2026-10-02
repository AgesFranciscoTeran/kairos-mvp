import { useId } from 'react';
import { normalizePhone, renderMessage, type Channel } from '../../session/escalation';
import type { Profile } from '../../store/db';
import { S } from '../strings';

/** Contacto de confianza + mensaje editable. Compartido por bienvenida y ajustes. */
export function ContactForm({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const id = useId();
  const c = value.contact ?? { name: '', phone: '', channel: 'whatsapp' as Channel };
  const setContact = (patch: Partial<typeof c>) => onChange({ ...value, contact: { ...c, ...patch } });
  const phoneBad = c.phone.trim() !== '' && normalizePhone(c.phone) === null;

  return (
    <div>
      <label className="field">
        <span>{S.onboarding.yourName}</span>
        <input type="text" autoComplete="given-name" value={value.userName} onChange={(e) => onChange({ ...value, userName: e.target.value })} />
      </label>
      <label className="field">
        <span>{S.onboarding.contactName}</span>
        <input type="text" value={c.name} onChange={(e) => setContact({ name: e.target.value })} />
      </label>
      <label className="field">
        <span>{S.onboarding.contactPhone}</span>
        <input
          type="tel"
          inputMode="tel"
          value={c.phone}
          aria-invalid={phoneBad}
          aria-describedby={`${id}-phone`}
          onChange={(e) => setContact({ phone: e.target.value })}
        />
        <span id={`${id}-phone`} className={phoneBad ? 'error-text' : 'hint'}>
          {S.onboarding.contactPhoneHint}
        </span>
      </label>
      <fieldset>
        <legend>{S.onboarding.channel}</legend>
        {(['whatsapp', 'sms'] as Channel[]).map((ch) => (
          <label key={ch} className="choice">
            <input type="radio" name={`${id}-channel`} checked={c.channel === ch} onChange={() => setContact({ channel: ch })} />
            <span>{ch === 'whatsapp' ? S.onboarding.channelWhatsapp : S.onboarding.channelSms}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>{S.onboarding.message}</span>
        <textarea
          value={value.messageTemplate}
          aria-describedby={`${id}-msg`}
          onChange={(e) => onChange({ ...value, messageTemplate: e.target.value })}
          maxLength={300}
        />
        <span id={`${id}-msg`} className="hint">
          {S.onboarding.messageHint}
        </span>
      </label>
      <p className="message-preview" aria-label={S.escalation.preview}>
        {renderMessage(value.messageTemplate, value.userName)}
      </p>
    </div>
  );
}

/** El contacto solo cuenta si tiene nombre y teléfono válido. */
export function cleanContact(p: Profile): Profile {
  const c = p.contact;
  const ok = c && c.name.trim() && normalizePhone(c.phone) !== null;
  return { ...p, contact: ok ? { ...c, name: c.name.trim(), phone: c.phone.trim() } : null };
}
