import { useEffect, useRef, useState } from 'react';
import type { PairingOffer, PhoneSummary } from '../../shared/api.ts';
import { Problems } from './Problems.tsx';

/** How often the screen looks for the phone while a code is showing. */
const LOOK_EVERY_MS = 2000;

const seen = (phones: PhoneSummary[]): Set<string> => new Set(phones.map((phone) => `${phone.id}@${phone.pairedAt}`));

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Pairs the Echo phone app with this PC, and lists and unpairs the phones already paired. */
export function PhonePanel() {
  const [phones, setPhones] = useState<PhoneSummary[] | null>(null);
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [news, setNews] = useState<{ kind: 'paired' | 'expired'; name?: string } | null>(null);
  const [unpairing, setUnpairing] = useState<string | null>(null);
  const before = useRef<Set<string>>(new Set());
  const showing = useRef(false);

  useEffect(() => {
    void window.echo.phones.list().then(setPhones);
    // Leaving the screen takes the code down with it.
    return () => {
      if (showing.current) void window.echo.phones.cancelPairing();
    };
  }, []);

  useEffect(() => {
    showing.current = offer !== null;
    if (!offer) return undefined;
    const look = setInterval(() => {
      void window.echo.phones.list().then((latest) => {
        const fresh = latest.find((phone) => !before.current.has(`${phone.id}@${phone.pairedAt}`));
        setPhones(latest);
        if (fresh) {
          setOffer(null);
          setNews({ kind: 'paired', name: fresh.name });
        }
      });
    }, LOOK_EVERY_MS);
    const runOut = setTimeout(() => {
      setOffer(null);
      setNews({ kind: 'expired' });
      void window.echo.phones.cancelPairing();
    }, Math.max(0, Date.parse(offer.expiresAt) - Date.now()));
    return () => {
      clearInterval(look);
      clearTimeout(runOut);
    };
  }, [offer]);

  async function showCode() {
    setNews(null);
    before.current = seen(phones ?? []);
    const result = await window.echo.phones.pair();
    setProblems(result.ok ? [] : result.problems);
    setOffer(result.ok ? result.offer : null);
  }

  async function cancel() {
    setOffer(null);
    await window.echo.phones.cancelPairing();
  }

  async function unpair(id: string) {
    setUnpairing(null);
    await window.echo.phones.unpair(id);
    setPhones(await window.echo.phones.list());
  }

  if (!phones) return null;

  return (
    <section className="panel" data-section="phone">
      <h2>Your phone</h2>
      <p>
        With the Echo app on your phone you can record a memory wherever you are, and be reminded at
        your memory times. What you record is locked on the phone so only this computer can open it,
        and it comes here over your own Wi-Fi, never the internet. The phone deletes its copy once
        this computer has saved it.
      </p>

      {news?.kind === 'paired' && (
        <p className="gentle" data-phone-paired>
          {news.name} is paired. Anything recorded on it will arrive here whenever both are on your Wi-Fi
          and your archive is open.
        </p>
      )}
      {news?.kind === 'expired' && (
        <p className="hint" data-phone-expired>
          That code has run out. Show a new one when the phone is ready.
        </p>
      )}

      {offer ? (
        <div className="pairing" data-pairing-offer>
          <img className="pairing-qr" src={offer.qr} alt="Pairing code for the Echo phone app" width={240} height={240} />
          <div>
            <ol className="pairing-steps">
              <li>Make sure the phone is on the same Wi-Fi as this computer.</li>
              <li>Open the Echo app on the phone and choose Pair with my computer.</li>
              <li>Point the phone at this square.</li>
            </ol>
            <p className="hint">
              This code works once, until {time(offer.expiresAt)}. If Windows asks whether Echo may use
              private networks, choose Allow.
            </p>
            <div className="actions">
              <button type="button" className="button-quiet" data-action="cancel-pairing" onClick={() => void cancel()}>
                Stop showing the code
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="button" data-action="pair-phone" onClick={() => void showCode()}>
            {phones.length === 0 ? 'Pair a phone' : 'Pair another phone'}
          </button>
        </div>
      )}
      <Problems problems={problems} />

      {phones.length > 0 && (
        <ul className="people" data-phone-list={phones.length}>
          {phones.map((phone) => (
            <li key={phone.id} data-phone={phone.id}>
              <div className="person-head">
                <strong>{phone.name}</strong>
                <span className="status">Paired {day(phone.pairedAt)}</span>
              </div>
              {unpairing === phone.id ? (
                <div className="actions">
                  <span className="remove-warning">
                    Anything still waiting on {phone.name} will no longer be able to come here. Let it
                    send first if you can.
                  </span>
                  <button type="button" className="button button-stop" data-action="confirm-unpair-phone" onClick={() => void unpair(phone.id)}>
                    Unpair {phone.name}
                  </button>
                  <button type="button" className="button-quiet" onClick={() => setUnpairing(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <div className="actions">
                  <button type="button" className="button-quiet" data-action="unpair-phone" onClick={() => setUnpairing(phone.id)}>
                    Unpair
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
