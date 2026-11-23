-- Eine Erstellung ist kein Importbeleg: Überlappungen bleiben anhand der Journal-IDs nachvollziehbar.
CREATE TRIGGER gbr_transfers_append_only BEFORE UPDATE OR DELETE ON gbr_transfers FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER gbr_transfers_audit AFTER INSERT ON gbr_transfers FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER gbr_transfers_no_truncate BEFORE TRUNCATE ON gbr_transfers FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
