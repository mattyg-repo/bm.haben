CREATE TABLE "gbr_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" smallint NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbr_partners_number_unique" UNIQUE("number"),
	CONSTRAINT "gbr_partners_number" CHECK ("gbr_partners"."number" between 1 and 9),
	CONSTRAINT "gbr_partners_name" CHECK (length(trim("gbr_partners"."name")) between 1 and 200),
	CONSTRAINT "gbr_partners_dates" CHECK ("gbr_partners"."ends_on" is null or "gbr_partners"."ends_on" >= "gbr_partners"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "gbr_source_partners" (
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	CONSTRAINT "gbr_source_partners_kind_source_id_pk" PRIMARY KEY("kind","source_id"),
	CONSTRAINT "gbr_source_partners_kind" CHECK ("gbr_source_partners"."kind" in ('document', 'bank', 'bankkonto'))
);
--> statement-breakpoint
ALTER TABLE "company" DROP CONSTRAINT "company_rechtsform";--> statement-breakpoint
ALTER TABLE "gbr_source_partners" ADD CONSTRAINT "gbr_source_partners_partner_id_gbr_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."gbr_partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_rechtsform" CHECK ("company"."rechtsform" in ('einzelunternehmen', 'gbr', 'gmbh', 'ug'));