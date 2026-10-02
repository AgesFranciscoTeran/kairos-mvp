import { useEffect, useRef, useState } from 'react';
import { ContactForm, cleanContact } from '../components/ContactForm';
import { HREF, useApp } from '../hooks';
import { S } from '../strings';

const STEPS = 3;

/** Bienvenida: qué es y qué no es Kairos, aviso de seguridad y contacto de confianza. */
export function Onboarding() {
  const { profile, setProfile } = useApp();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(profile);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // al cambiar de paso, el foco va al título (lector de pantalla y teclado)
  useEffect(() => headingRef.current?.focus(), [step]);

  const finish = async (withContact: boolean) => {
    const p = withContact ? cleanContact(draft) : { ...draft, contact: null };
    await setProfile({ ...p, onboarded: true });
    location.hash = HREF.session;
  };

  return (
    <section className="card" aria-labelledby="ob-title" style={{ maxWidth: 560, margin: '0 auto' }}>
      <p className="muted">{S.onboarding.step(step, STEPS)}</p>

      {step === 1 && (
        <>
          <h1 id="ob-title" ref={headingRef} tabIndex={-1}>
            {S.onboarding.whatTitle}
          </h1>
          {S.onboarding.whatBody.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <h2>{S.onboarding.whatNotTitle}</h2>
          <ul>
            {S.onboarding.whatNot.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="row between">
            <span />
            <button type="button" className="btn primary" onClick={() => setStep(2)}>
              {S.onboarding.next}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 id="ob-title" ref={headingRef} tabIndex={-1}>
            {S.onboarding.safetyTitle}
          </h1>
          <p className="banner">
            <strong>{S.onboarding.safetyMedical}</strong>
          </p>
          <p className="banner">
            <strong>{S.onboarding.safetyEmergency}</strong>{' '}
            <a href="tel:911">{S.escalation.emergencyCall}</a>
          </p>
          <p>{S.onboarding.safetyPrivacy}</p>
          <p>{S.onboarding.safetyBackground}</p>
          <div className="row between">
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>
              {S.onboarding.back}
            </button>
            <button type="button" className="btn primary" onClick={() => setStep(3)}>
              {S.onboarding.safetyAccept}
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h1 id="ob-title" ref={headingRef} tabIndex={-1}>
            {S.onboarding.contactTitle}
          </h1>
          <p>{S.onboarding.contactIntro}</p>
          <ContactForm value={draft} onChange={setDraft} />
          <div className="row between">
            <button type="button" className="btn ghost" onClick={() => setStep(2)}>
              {S.onboarding.back}
            </button>
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => void finish(false)}>
                {S.onboarding.contactLater}
              </button>
              <button type="button" className="btn primary" onClick={() => void finish(true)}>
                {S.onboarding.finish}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
