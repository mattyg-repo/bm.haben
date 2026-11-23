-- SKR04-Spenden (2250–2259, DATEV 1000181) gehören bei der GbR ebenfalls zu den festen Gesellschafterkonten.
CREATE OR REPLACE FUNCTION haben_gbr_partner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gesellschafter bleiben mit ihren Konten erhalten; bitte einen Austritt eintragen' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.number IS DISTINCT FROM OLD.number OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Kennung und Konten eines Gesellschafters bleiben unverändert' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE ((e.kontenrahmen = 'SKR03' AND l.account ~ '^18[0-9][1-9]$')
      OR (e.kontenrahmen = 'SKR04' AND (l.account ~ '^21[0-9][1-9]$' OR l.account ~ '^225[1-9]$')))
      AND right(l.account, 1)::int = OLD.number AND e.reverses_id IS NULL
      AND (e.date < NEW.starts_on OR (NEW.ends_on IS NOT NULL AND e.date > NEW.ends_on))
  ) THEN
    RAISE EXCEPTION 'Eintritt oder Austritt würde bestehende Privatbuchungen ausschließen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_gbr_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kr text;
  d date;
  reversal uuid;
  p gbr_partners%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM company WHERE id = 1 AND rechtsform = 'gbr') THEN RETURN NEW; END IF;
  SELECT kontenrahmen, date, reverses_id INTO kr, d, reversal FROM journal_entries WHERE id = NEW.entry_id;
  IF (kr = 'SKR03' AND NEW.account ~ '^18[0-9]{2}$')
    OR (kr = 'SKR04' AND (NEW.account ~ '^21[0-9]{2}$' OR NEW.account ~ '^225[0-9]$')) THEN
    SELECT * INTO p FROM gbr_partners WHERE number = right(NEW.account, 1)::int FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Privatkonto ohne angelegten Gesellschafter' USING ERRCODE = 'check_violation'; END IF;
    IF reversal IS NULL AND (d < p.starts_on OR (p.ends_on IS NOT NULL AND d > p.ends_on)) THEN
      RAISE EXCEPTION 'Privatbuchung außerhalb der Beteiligung des Gesellschafters' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
