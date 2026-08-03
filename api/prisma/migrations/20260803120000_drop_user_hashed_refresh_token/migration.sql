-- The bcrypt `hashedRefreshToken` column is replaced by the opaque, rotated
-- RefreshToken table (cookie-based auth). Drop the now-unused column.
ALTER TABLE "public"."User" DROP COLUMN "hashedRefreshToken";
