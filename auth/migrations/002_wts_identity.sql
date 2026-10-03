CREATE TABLE wts_instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  issuer text NOT NULL UNIQUE,
  "schemaVersion" integer NOT NULL CHECK ("schemaVersion" = 2)
);
CREATE TABLE wts_identity (
  issuer text NOT NULL REFERENCES wts_instance(issuer),
  subject text NOT NULL,
  "wtsUserId" text NOT NULL UNIQUE,
  "authUserId" text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE RESTRICT,
  PRIMARY KEY (issuer, subject),
  CHECK (subject = "authUserId")
);
CREATE TABLE wts_import (
  "sourceKey" text PRIMARY KEY,
  "snapshotHash" text NOT NULL,
  "userCount" integer NOT NULL,
  "committedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wts_import_user (
  "sourceKey" text NOT NULL REFERENCES wts_import("sourceKey"),
  "sourceId" text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  "sourceEmail" text NOT NULL,
  "sourceHash" text NOT NULL,
  PRIMARY KEY ("sourceKey", "sourceId"),
  UNIQUE ("sourceId")
);
CREATE TABLE wts_client_manifest (
  "clientId" text PRIMARY KEY REFERENCES "oauthClient"("clientId") ON DELETE RESTRICT,
  "manifestHash" text NOT NULL,
  "secretHash" text NOT NULL
);
CREATE UNIQUE INDEX account_provider_owner_uidx ON account("providerId", "accountId");
CREATE UNIQUE INDEX user_normalized_email_uidx ON "user"(lower(email));
ALTER TABLE "user" ADD CONSTRAINT user_profile_revision_positive CHECK ("profileRevision" > 0);
ALTER TABLE "user" ADD CONSTRAINT user_email_no_outer_whitespace CHECK (email = btrim(email));

CREATE FUNCTION wts_bind_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE canonical_issuer text;
BEGIN
  SELECT issuer INTO STRICT canonical_issuer FROM public.wts_instance WHERE singleton = true;
  INSERT INTO public.wts_identity(issuer, subject, "wtsUserId", "authUserId")
    VALUES (canonical_issuer, NEW.id, NEW.id, NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wts_bind_identity() FROM PUBLIC;
CREATE TRIGGER user_bind_identity AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION wts_bind_identity();

CREATE FUNCTION wts_immutable_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'The installed identity policy is immutable.';
END;
$$;
CREATE TRIGGER identity_immutable BEFORE UPDATE OR DELETE ON wts_identity FOR EACH ROW EXECUTE FUNCTION wts_immutable_identity();
CREATE TRIGGER instance_immutable BEFORE UPDATE OR DELETE ON wts_instance FOR EACH ROW EXECUTE FUNCTION wts_immutable_identity();
CREATE TRIGGER client_policy_immutable BEFORE UPDATE OR DELETE ON "oauthClient" FOR EACH ROW EXECUTE FUNCTION wts_immutable_identity();
CREATE TRIGGER client_manifest_immutable BEFORE UPDATE OR DELETE ON wts_client_manifest FOR EACH ROW EXECUTE FUNCTION wts_immutable_identity();

CREATE FUNCTION wts_account_owner_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD."userId" IS DISTINCT FROM NEW."userId" OR OLD."accountId" IS DISTINCT FROM NEW."accountId" OR OLD."providerId" IS DISTINCT FROM NEW."providerId" THEN
    RAISE EXCEPTION 'The account identity owner is immutable.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_owner_immutable BEFORE UPDATE ON account FOR EACH ROW EXECUTE FUNCTION wts_account_owner_immutable();
