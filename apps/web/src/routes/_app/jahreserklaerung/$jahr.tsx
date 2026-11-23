import { RECHTSFORMEN, formatEuro, isKapitalgesellschaft } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { AnlageNFields, toArbeitnehmerDraft } from "../../../components/AnlageN.tsx";
import { GewstSection, KapgAngaben, KapgGemeinsameHinweise, KstSection } from "../../../components/KapgErklaerungen.tsx";
import { EricHinweis } from "../../../components/EricHinweis.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { VastBelege } from "../../../components/VastBelege.tsx";
import { KIRCHENSTEUER_HINWEIS } from "../../../lib/kirchensteuer.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getAnnualReturns, saveIncomeTaxInputs } from "../../../server/functions/annual.ts";
import styles from "../../../styles/auswertungen.css?url";
import { ScrollTable } from "../../../components/ScrollTable.tsx";
import { Field } from "../../../components/Field.tsx";
import { Block } from "../../../components/jahreserklaerung/Block.tsx";
import { ErklaerteZeilen } from "../../../components/jahreserklaerung/ErklaerteZeilen.tsx";
import {
  Amount,
  ErsatzBlock,
  KinderBlock,
  type KindDraft,
  VorsorgeBlock,
  centsText,
  estAngabenAusFormular,
  sumOf,
  sumText,
} from "../../../components/jahreserklaerung/EstAngaben.tsx";
import { Reihenfolge, SentPill } from "../../../components/jahreserklaerung/Reihenfolge.tsx";
import { Row } from "../../../components/jahreserklaerung/Row.tsx";
import type { Data } from "../../../components/jahreserklaerung/typen.ts";
import { SubmitPanel } from "./-jahr-senden.tsx";
import { EuerSection, History, Issues, UstSection } from "./-jahr-teile.tsx";

export const Route = createFileRoute("/_app/jahreserklaerung/$jahr")({
  loader: ({ params }) => {
    const year = Number(params.jahr);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound();
    return getAnnualReturns({ data: year });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Jahreserklärung ${loaderData?.year ?? ""} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AnnualPage,
});

function AnnualPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  // GmbH und UG: Körperschaftsteuer statt Einkommensteuer, Bilanz statt EÜR; hier bleibt die Umsatzsteuer
  const gesellschaft = isKapitalgesellschaft(data.rechtsform);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jahreserklärung</div>
          <h1>Steuerjahr {data.year}</h1>
        </div>
        <Field label="Jahr">
          {(control) => (
            <select {...control} value={data.year} onChange={(e) => navigate({ to: "/jahreserklaerung/$jahr", params: { jahr: e.target.value } })}>
              {(data.years.includes(data.year) ? data.years : [data.year, ...data.years]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {data.mode === "simuliert" && <EricHinweis />}
      {data.rechtsform === "gbr" && (
        <p className="banner">
          Die EÜR-GbR führt hier ihre Umsatzsteuer. Gewinnverteilung und Feststellungserklärung werden in dieser Ausbaustufe außerhalb von Haben erstellt; die
          laufende EÜR steht unter Auswertungen.
        </p>
      )}

      {gesellschaft && (
        <>
          <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
            Umsatzsteuer-, Körperschaftsteuer- und Gewerbesteuererklärung rechnet Haben aus den Buchungen und dem <Link to="/abschluss">Jahresabschluss</Link>.
            Anlage EÜR und Einkommensteuer gibt es für {RECHTSFORMEN[data.rechtsform]} nicht.
          </p>
          <nav className="jump-nav" aria-label="Abschnitte der Jahreserklärung">
            <a href="#ust">Umsatzsteuer</a>
            <a href="#kst">Körperschaftsteuer</a>
            <a href="#gewst">Gewerbesteuer</a>
            <a href="#kapg-angaben">Angaben</a>
            <a href="#verlauf">Verlauf</a>
          </nav>
        </>
      )}

      <div className="stack" style={{ gap: 24 }}>
        {data.rechtsform === "einzelunternehmen" && <Reihenfolge data={data} />}
        <UstSection data={data} />
        {data.rechtsform === "einzelunternehmen" && <EuerSection data={data} />}
        {data.rechtsform === "einzelunternehmen" && <EstSection key={data.year} data={data} />}
        {data.kapg && <KapgGemeinsameHinweise data={data} />}
        {data.kapg && <KstSection data={data} />}
        {data.kapg && <GewstSection data={data} />}
        {data.kapg && <KapgAngaben key={`kapg-${data.year}`} data={data} />}
        {/* Die vorausgefüllte Steuererklärung gibt es nur für die Einkommensteuer einer Person */}
        {data.rechtsform === "einzelunternehmen" && (
          <div id="vast" className="jump-target">
            <VastBelege key={`vast-${data.year}`} data={data} />
          </div>
        )}
        <History data={data} />
      </div>
    </>
  );
}

/**
 * Klappt die Blöcke um ein ungültiges Feld auf. Sonst kann der Browser ein leeres Pflichtfeld in einem zugeklappten
 * Block nicht zeigen, und das Absenden bleibt ohne Rückmeldung stehen. `invalid` steigt nicht auf, deshalb in der
 * Capture-Phase am Formular.
 */
function aufklappenBisZumFeld(event: FormEvent<HTMLFormElement>) {
  for (let block = (event.target as HTMLElement).closest("details"); block; block = block.parentElement?.closest("details") ?? null) block.open = true;
}

function EstSection({ data }: { data: Data }) {
  const { est } = data;
  const a = est.angaben;
  const router = useRouter();
  const save = useServerFn(saveIncomeTaxInputs);
  const [kinder, setKinder] = useState<KindDraft[]>(() => a.kinder.map((k, key) => ({ ...k, key, kinderbetreuung: centsText(k.kinderbetreuung) })));
  // Nach dem Vermerk ist die Erklärung von außen abgegeben; die Maske wird gelesen, bis jemand sie ausdrücklich öffnet (#1083)
  const [bearbeiten, setBearbeiten] = useState(false);
  const gesperrt = est.submitted !== null && !bearbeiten;
  const [anA, setAnA] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.a));
  const [anB, setAnB] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.b));
  const nameA = est.person.a?.split(" ")[0] ?? "Person A";
  const nameB = est.person.b?.split(" ")[0] ?? "Ehegatte";
  const { busy, notice, setNotice, run } = useAction();
  const blocked = est.issues.some((i) => i.tone === "fehler");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Gesperrt speichert nichts: landet ein Fehlklick beim Umschalten der Fußzeile auf dem Absende-Knopf, darf er die
    // nur zum Lesen geöffnete Maske nicht überschreiben (#1141)
    if (gesperrt) return;
    const bad: string[] = [];
    const angaben = estAngabenAusFormular(new FormData(event.currentTarget), est, { kinder, anA, anB, nameA, nameB }, bad);
    if (bad.length > 0) {
      setNotice({ tone: "danger", text: `Kein gültiger Betrag: ${bad.join(", ")}.` });
      return;
    }
    // Nach dem Speichern wieder sperren: die Maske ist ohne „Angaben bearbeiten" nur zum Lesen da, und ein
    // zweiter Klick auf „Angaben speichern" darf die Eingabe nicht offen lassen (#1098)
    const gespeichert = await run(async () => {
      await save({ data: { year: data.year, angaben } });
      await router.invalidate();
    }, "Angaben gespeichert.");
    if (gespeichert) setBearbeiten(false);
  }

  return (
    <section className="grid-main jump-target" id="est" aria-labelledby="est-heading">
      <form className="card" onSubmit={onSubmit} onInvalidCapture={aufklappenBisZumFeld} aria-label="Angaben zur Einkommensteuer">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <h2 id="est-heading">Einkommensteuererklärung {data.year}</h2>
          <SentPill teil={est} />
        </div>
        <Issues issues={est.issues} />
        <ScrollTable className="report-table">
          <tbody>
            <Row label="Steuerpflichtige Person" value={est.person.a ?? "–"} text />
            <Row label="Veranlagung" value={est.zusammen ? `Zusammen mit ${est.person.b ?? "–"}` : "Einzeln"} text />
            {/* Ohne Buchungen im Jahr steht hier 0,00 — das ist keine Aussage über den Gewinn,
                  sondern über Habens Datenlage (#869) */}
            {est.gewinn !== 0 && <Row label="Gewinn laut EÜR" value={formatEuro(est.gewinn)} />}
            <Row label="Anlagen" value={est.anlagen.join(", ")} text />
          </tbody>
        </ScrollTable>
        <ScrollTable className="report-table">
          <tbody>
            {est.prognose.einkuenfteArbeit !== 0 && <Row label="Einkünfte aus Arbeitslohn (geschätzt)" value={formatEuro(est.prognose.einkuenfteArbeit)} />}
            <Row label="Zu versteuerndes Einkommen (geschätzt)" value={formatEuro(est.prognose.zvE)} />
            <Row
              label="Voraussichtliche Steuer"
              value={formatEuro(est.prognose.gesamt)}
              kz={[
                `ESt ${formatEuro(est.prognose.einkommensteuer)}`,
                est.prognose.soli ? `Soli ${formatEuro(est.prognose.soli)}` : "",
                est.prognose.kirchensteuer ? `KiSt ${formatEuro(est.prognose.kirchensteuer)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            {est.prognose.steuerabzug > 0 && (
              <>
                <Row label="Bereits einbehalten (Lohnsteuer, Soli, KiSt)" value={formatEuro(est.prognose.steuerabzug)} />
                <Row
                  label={est.prognose.verbleibend >= 0 ? "Voraussichtlich nachzuzahlen" : "Voraussichtliche Erstattung"}
                  value={formatEuro(Math.abs(est.prognose.verbleibend))}
                  total
                />
              </>
            )}
          </tbody>
        </ScrollTable>

        {/* Ohne Vermerk hängt keine Zeile, dann zeigt der Baustein nichts. Mit Vermerk muss die Eingabe auch ohne
            gespeicherte Zeile erreichbar sein, sonst ließen sich die Anlagen nie erfassen (#1149) */}
        <ErklaerteZeilen form="est" year={data.year} zeilen={est.erklaert} vermerkt={est.submitted !== null} />

        <fieldset disabled={gesperrt} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <AnlageNFields wer={nameA} draft={anA} onChange={setAnA} />
          {est.zusammen && <AnlageNFields wer={nameB} draft={anB} onChange={setAnB} />}

          <VorsorgeBlock est={est} />

          <Block
            title="Sonderausgaben und Belastungen"
            summary={sumText(sumOf(a.sonderausgaben.kirchensteuerGezahlt, a.sonderausgaben.spenden, a.krankheitskosten))}
            open={false}
          >
            <div className="form-grid">
              <Amount name="kistGezahlt" label="Gezahlte Kirchensteuer" value={a.sonderausgaben.kirchensteuerGezahlt} hint={KIRCHENSTEUER_HINWEIS} />
              <Amount name="kistErstattet" label="Erstattete Kirchensteuer" value={a.sonderausgaben.kirchensteuerErstattet} />
              <Amount name="spenden" label="Spenden und Mitgliedsbeiträge" value={a.sonderausgaben.spenden} hint="an steuerbegünstigte Empfänger im Inland" />
              <Amount name="krankheitskosten" label="Krankheitskosten" value={a.krankheitskosten} hint="selbst getragen, nach Erstattungen" />
            </div>
          </Block>

          <Block
            title="Haushaltsnahe Aufwendungen (§ 35a EStG)"
            summary={sumText(sumOf(a.haushaltsnah.minijobs, a.haushaltsnah.dienstleistungen, a.haushaltsnah.handwerker))}
            open={false}
          >
            <div className="form-grid">
              <Amount name="minijobs" label="Minijobs im Haushalt" value={a.haushaltsnah.minijobs} />
              <Amount
                name="dienstleistungen"
                label="Haushaltsnahe Dienstleistungen"
                value={a.haushaltsnah.dienstleistungen}
                hint="z. B. Reinigung, Gartenpflege"
              />
              <Amount name="handwerker" label="Handwerkerleistungen" value={a.haushaltsnah.handwerker} hint="nur Arbeits-, Maschinen- und Fahrtkosten" />
            </div>
          </Block>

          <KinderBlock kinder={kinder} setKinder={setKinder} />

          <Block
            title="Kapitalerträge (Anlage KAP)"
            summary={sumText(sumOf(a.kap?.ertraegeMitSteuerabzug, a.kap?.ertraegeOhneSteuerabzugInland, a.kap?.ertraegeAusland))}
            open={false}
          >
            <div className="form-grid">
              <Amount name="kapMit" label="Erträge mit Steuerabzug" value={a.kap?.ertraegeMitSteuerabzug} hint="laut Steuerbescheinigung der Bank" />
              <Amount name="kapSpb" label="Davon genutzter Sparer-Pauschbetrag" value={a.kap?.sparerPauschbetrag} />
              <Amount name="kapOhneInl" label="Inländische Erträge ohne Steuerabzug" value={a.kap?.ertraegeOhneSteuerabzugInland} />
              <Amount name="kapAusl" label="Ausländische Erträge" value={a.kap?.ertraegeAusland} />
              <Amount name="kapESt" label="Einbehaltene Kapitalertragsteuer" value={a.kap?.kapitalertragsteuer} />
              <Amount name="kapSoli" label="Solidaritätszuschlag" value={a.kap?.soli} />
              <Amount name="kapKiSt" label="Kirchensteuer zur Kapitalertragsteuer" value={a.kap?.kirchensteuer} />
              <label className="checkbox" style={{ alignSelf: "end" }}>
                <input type="checkbox" name="guenstigerpruefung" defaultChecked={a.kap?.guenstigerpruefung ?? false} />
                Günstigerprüfung beantragen
              </label>
            </div>
          </Block>

          <ErsatzBlock est={est} />
        </fieldset>
        <p className="small muted" style={{ margin: 0 }}>
          Beträge in Euro; ELSTER bekommt volle Euro, mit Cent nur die Steuern auf Kapitalerträge und Nr. 3 bis 7 der Lohnsteuerbescheinigungen, die Summe des
          Bruttoarbeitslohns ohne Cent. Übermittelt werden die gespeicherten Angaben.
        </p>
        {/* Speichern bleibt unten sichtbar; der Hinweis steht davor, weil der Footer mit negativem Rand darüber liegt.
            Beide Knöpfe stehen an verschiedener Stelle: „Angaben speichern“ links, „Angaben bearbeiten“ rechts. Teilen
            sie sich denselben Platz, tauscht der Klick den Knopf unter dem aufgelegten Zeiger aus, und das Loslassen
            speichert die gerade erst geöffnete, leere Maske (#1141). */}
        <div className="form-sticky-footer">
          <NoticeBanner notice={notice} />
          <div className="actions" style={{ alignItems: "center" }}>
            {!gesperrt && (
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Angaben speichern
              </button>
            )}
            <span className="small muted">
              {gesperrt
                ? `Außerhalb von Haben abgegeben; Haben rechnet ${formatEuro(est.prognose.gesamt)}.`
                : `Voraussichtliche Steuer ${formatEuro(est.prognose.gesamt)}`}
            </span>
            {gesperrt && (
              <button
                type="button"
                className="btn"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  setNotice(null);
                  setBearbeiten(true);
                }}
              >
                Angaben bearbeiten
              </button>
            )}
          </div>
        </div>
      </form>
      <SubmitPanel form="est" data={data} blocked={blocked} sent={Boolean(est.sent)} submitted={est.submitted} />
    </section>
  );
}
