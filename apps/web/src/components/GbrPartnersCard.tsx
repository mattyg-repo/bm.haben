import { formatEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { createGbrPartnerFn, getGbrPartners, updateGbrPartnerFn } from "../server/functions/gbr.ts";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Overview = Awaited<ReturnType<typeof getGbrPartners>>;
type Partner = Overview["partners"][number];

export function GbrPartnersCard() {
  const load = useServerFn(getGbrPartners);
  const create = useServerFn(createGbrPartnerFn);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Overview | null>(null);
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState(`${year}-01-01`);
  const { busy, notice, run, setNotice } = useAction();
  const { form, error, check } = useSubmitCheck({ name: name.trim() ? null : "Trag den Namen ein.", startsOn: startsOn ? null : "Trag den Eintritt ein." });
  const reload = async () => setData(await load({ data: { year } }));
  useEffect(() => {
    let active = true;
    void load({ data: { year } })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setNotice({ tone: "danger", text: "Gesellschafter konnten nicht geladen werden." });
      });
    return () => {
      active = false;
    };
  }, [load, year, setNotice]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      await create({ data: { name, startsOn, endsOn: null } });
      setName("");
      await reload();
    }, "Gesellschafter angelegt.");
  }
  return (
    <section className="card stack" aria-label="GbR-Gesellschafterkonten">
      <h2 style={{ margin: 0 }}>Gesellschafterkonten der GbR</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Privatbewegungen je Gesellschafter mit festen Konten für den DATEV-Export. Bis zu neun Kennungen; ausgeschiedene Gesellschafter bleiben erhalten. Die
        Gewinnverteilung und Feststellungserklärung erledigst du in dieser Ausbaustufe außerhalb von Haben.
      </p>
      <NoticeBanner notice={notice} />
      <form ref={form} onSubmit={submit} noValidate className="stack" aria-label="Gesellschafter anlegen">
        <div className="form-row cols-2">
          <Field label="Name des Gesellschafters" error={error("name")}>
            {(control) => <input {...control} name="name" value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Eintritt" error={error("startsOn")}>
            {(control) => <input {...control} name="startsOn" type="date" value={startsOn} required onChange={(e) => setStartsOn(e.target.value)} />}
          </Field>
        </div>
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Gesellschafter anlegen
          </button>
        </div>
      </form>
      <Field label="Auswertungsjahr">
        {(control) => (
          <input
            {...control}
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (next >= 2000 && next <= 2100) setYear(next);
            }}
          />
        )}
      </Field>
      {data?.partners.length === 0 && <p className="muted">Noch keine Gesellschafter angelegt.</p>}
      {data?.partners.map((partner) => (
        <PartnerRow key={partner.id} partner={partner} year={year} onSaved={reload} />
      ))}
      <p className="small muted" style={{ margin: 0 }}>
        Die Salden enthalten Einlagen, Entnahmen und Erstattungen einschließlich Vorjahren, ohne Gewinnverteilung. Anfangsbestände aus der bisherigen
        Buchhaltung übernimmst du unter „Buchungen → Buchung erfassen → Eröffnungsbuchung“ auf das jeweilige Privatkonto gegen 9000. Ein Bestand darf nur einmal
        übernommen werden.
      </p>
    </section>
  );
}

function PartnerRow({ partner: p, year, onSaved }: { partner: Partner; year: number; onSaved: () => Promise<void> }) {
  const update = useServerFn(updateGbrPartnerFn);
  const [name, setName] = useState(p.name);
  const [startsOn, setStartsOn] = useState(p.startsOn);
  const [endsOn, setEndsOn] = useState(p.endsOn ?? "");
  const { busy, notice, run } = useAction();
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 16, gap: 8 }}>
      <strong>
        {p.name}
        {p.endsOn ? ` · ausgeschieden am ${p.endsOn}` : ""}
      </strong>
      <div className="small">
        Entnahmen {p.withdrawal} · Einlagen {p.deposit}
      </div>
      <dl className="small" style={{ margin: 0 }}>
        <dt>Saldo zum 01.01.{year}</dt>
        <dd className="amount">{formatEuro(p.opening)}</dd>
        <dt>Soll / Haben im Jahr</dt>
        <dd className="amount">
          {formatEuro(p.debit)} / {formatEuro(p.credit)}
        </dd>
        <dt>Saldo zum 31.12.{year} ohne Gewinnverteilung</dt>
        <dd className="amount">{formatEuro(p.balance)}</dd>
      </dl>
      <details>
        <summary>Angaben ändern</summary>
        <form
          className="stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await update({ data: { id: p.id, partner: { name, startsOn, endsOn: endsOn || null } } });
              await onSaved();
            }, "Gesellschafter gespeichert.");
          }}
        >
          <Field label={`Name von ${p.name}`}>
            {(control) => <input {...control} value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={`Eintritt von ${p.name}`}>
            {(control) => <input {...control} type="date" value={startsOn} required onChange={(e) => setStartsOn(e.target.value)} />}
          </Field>
          <Field label={`Austritt von ${p.name}`} hint="Leer lassen, solange die Beteiligung besteht.">
            {(control) => <input {...control} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
          </Field>
          <NoticeBanner notice={notice} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Gesellschafter speichern
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
