-- GbR-Zuordnungen liegen neben versiegelten Vorgängen. Ab Buchung unveränderbar; feste Kontenkennung und Audit.
CREATE FUNCTION haben_gbr_partner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gesellschafter bleiben mit ihren Konten erhalten; bitte einen Austritt eintragen' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.number IS DISTINCT FROM OLD.number OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Kennung und Konten eines Gesellschafters bleiben unverändert' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE ((e.kontenrahmen = 'SKR03' AND l.account ~ '^18[0-9][1-9]$') OR (e.kontenrahmen = 'SKR04' AND l.account ~ '^21[0-9][1-9]$'))
      AND right(l.account, 1)::int = OLD.number AND e.reverses_id IS NULL
      AND (e.date < NEW.starts_on OR (NEW.ends_on IS NOT NULL AND e.date > NEW.ends_on))
  ) THEN
    RAISE EXCEPTION 'Eintritt oder Austritt würde bestehende Privatbuchungen ausschließen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gbr_partners_guard BEFORE UPDATE OR DELETE ON gbr_partners FOR EACH ROW EXECUTE FUNCTION haben_gbr_partner_guard();
--> statement-breakpoint
CREATE TRIGGER gbr_partners_audit AFTER INSERT OR UPDATE OR DELETE ON gbr_partners FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER gbr_partners_no_truncate BEFORE TRUNCATE ON gbr_partners FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE FUNCTION haben_gbr_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k text;
  source uuid;
  booked boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.source_id IS DISTINCT FROM OLD.source_id) THEN
    RAISE EXCEPTION 'Die Quelle einer Gesellschafterzuordnung bleibt unverändert' USING ERRCODE = 'check_violation';
  END IF;
  k := CASE WHEN TG_OP = 'DELETE' THEN OLD.kind ELSE NEW.kind END;
  source := CASE WHEN TG_OP = 'DELETE' THEN OLD.source_id ELSE NEW.source_id END;
  IF k = 'document' THEN
    SELECT locked_at IS NOT NULL INTO booked FROM documents WHERE id = source FOR UPDATE;
  ELSIF k = 'bank' THEN
    PERFORM id FROM bank_transactions WHERE id = source FOR UPDATE;
    IF FOUND THEN SELECT EXISTS (SELECT 1 FROM allocations WHERE transaction_id = source) INTO booked; END IF;
  ELSIF k = 'bankkonto' THEN
    PERFORM id FROM bank_accounts WHERE id = source AND purpose = 'privat' FOR UPDATE;
    IF FOUND THEN
      SELECT EXISTS (SELECT 1 FROM allocations a JOIN bank_transactions t ON t.id = a.transaction_id WHERE t.bank_account_id = source) INTO booked;
    END IF;
  END IF;
  IF booked IS NULL THEN RAISE EXCEPTION 'Quelle der Gesellschafterzuordnung nicht gefunden oder kein privates Konto' USING ERRCODE = 'check_violation'; END IF;
  IF booked THEN RAISE EXCEPTION 'Der Vorgang ist bereits gebucht; die Gesellschafterzuordnung bleibt unverändert' USING ERRCODE = 'check_violation'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gbr_source_partners_guard BEFORE INSERT OR UPDATE OR DELETE ON gbr_source_partners FOR EACH ROW EXECUTE FUNCTION haben_gbr_source_guard();
--> statement-breakpoint
CREATE TRIGGER gbr_source_partners_audit AFTER INSERT OR UPDATE OR DELETE ON gbr_source_partners FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER gbr_source_partners_no_truncate BEFORE TRUNCATE ON gbr_source_partners FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE FUNCTION haben_gbr_company_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.rechtsform = 'gbr' AND NEW.kontenrahmen IS DISTINCT FROM OLD.kontenrahmen AND EXISTS (SELECT 1 FROM journal_entries) THEN
    RAISE EXCEPTION 'Bei der GbR bleibt der Kontenrahmen ab der ersten Buchung fest; die Gesellschafterkonten werden vorgetragen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_gbr_guard BEFORE UPDATE ON company FOR EACH ROW EXECUTE FUNCTION haben_gbr_company_guard();
--> statement-breakpoint
CREATE FUNCTION haben_gbr_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kr text;
  d date;
  reversal uuid;
  p gbr_partners%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM company WHERE id = 1 AND rechtsform = 'gbr') THEN RETURN NEW; END IF;
  SELECT kontenrahmen, date, reverses_id INTO kr, d, reversal FROM journal_entries WHERE id = NEW.entry_id;
  IF (kr = 'SKR03' AND NEW.account ~ '^18[0-9]{2}$') OR (kr = 'SKR04' AND NEW.account ~ '^21[0-9]{2}$') THEN
    SELECT * INTO p FROM gbr_partners WHERE number = right(NEW.account, 1)::int FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Privatkonto ohne angelegten Gesellschafter' USING ERRCODE = 'check_violation'; END IF;
    IF reversal IS NULL AND (d < p.starts_on OR (p.ends_on IS NOT NULL AND d > p.ends_on)) THEN
      RAISE EXCEPTION 'Privatbuchung außerhalb der Beteiligung des Gesellschafters' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_gbr_guard BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION haben_gbr_journal_guard();
