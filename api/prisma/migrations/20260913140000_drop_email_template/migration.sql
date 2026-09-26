-- Reverts the EmailTemplate table added earlier the same day. Email copy went
-- back into code (src/mail/mail.templates.ts): there are exactly two
-- transactional emails, both fire automatically, and neither was ever edited
-- through an API — a table and five admin routes bought nothing.
DROP TABLE IF EXISTS "public"."EmailTemplate";
