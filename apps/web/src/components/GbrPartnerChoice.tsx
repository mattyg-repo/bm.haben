import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getGbrPartners, getGbrSource, saveGbrSourceFn } from "../server/functions/gbr.ts";
import { useAction } from "../lib/use-action.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Auswahl bei Kasse und Aufteilungen; die Kennung gehört zur Buchung und wird mit ihr festgeschrieben. */
export function GbrPartnerChoice({ value, onChange, disabled = false }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const load = useServerFn(getGbrPartners);
  const [partners, setPartners] = useState<Awaited<ReturnType<typeof getGbrPartners>>["partners"]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void load({ data: { year: Number(new Date().getFullYear()) } })
      .then((data) => {
        if (active) setPartners(data.partners);
      })
      .catch(() => {
        if (active) setError("Gesellschafter konnten nicht geladen werden.");
      });
    return () => {
      active = false;
    };
  }, [load]);
  return (
    <Field label="Gesellschafter" error={error || undefined} hint="Für Einlagen, Entnahmen und aus privatem Geld bezahlte Vorgänge.">
      {(control) => (
        <select {...control} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
          <option value="">Bitte wählen</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.withdrawal} / {p.deposit}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Neben einem Beleg oder Bankumsatz gespeichert; ab der ersten Buchung schützt der Server die Auswahl. */
export function GbrSourceChoice({
  kind,
  sourceId,
  disabled = false,
  label = "Gesellschafter",
}: {
  kind: "document" | "bank" | "bankkonto";
  sourceId: string;
  disabled?: boolean;
  label?: string;
}) {
  const load = useServerFn(getGbrSource);
  const save = useServerFn(saveGbrSourceFn);
  const [data, setData] = useState<Awaited<ReturnType<typeof getGbrSource>> | null>(null);
  const { busy, notice, run, setNotice } = useAction();
  useEffect(() => {
    let active = true;
    void load({ data: { kind, sourceId } })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setNotice({ tone: "danger", text: "Gesellschafter konnten nicht geladen werden." });
      });
    return () => {
      active = false;
    };
  }, [kind, sourceId, load, setNotice]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field
        label={label}
        hint={data?.locked ? "Mit der Buchung festgeschrieben." : "Bei Privatbewegungen vor dem Buchen wählen. Die Auswahl wird sofort gespeichert."}
      >
        {(control) => (
          <select
            {...control}
            value={data?.partnerId ?? ""}
            disabled={disabled || busy || !data || data.locked}
            onChange={(event) => {
              const partnerId = event.target.value || null;
              void run(async () => {
                await save({ data: { kind, sourceId, partnerId } });
                setData((previous) => (previous ? { ...previous, partnerId } : previous));
              }, "Gesellschafter gespeichert.");
            }}
          >
            <option value="">{data?.inheritedName ? `Kontovorgabe: ${data.inheritedName}` : "Bitte wählen"}</option>
            {data?.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <NoticeBanner notice={notice} />
    </div>
  );
}
