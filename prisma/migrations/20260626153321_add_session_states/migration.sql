-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SessionState" ADD VALUE 'KYC_NAME';
ALTER TYPE "SessionState" ADD VALUE 'KYC_EMAIL';
ALTER TYPE "SessionState" ADD VALUE 'INTENT_SELECTION';
ALTER TYPE "SessionState" ADD VALUE 'ONBOARDING_BUSINESS_NAME';
ALTER TYPE "SessionState" ADD VALUE 'ONBOARDING_BUSINESS_SERVICE';
ALTER TYPE "SessionState" ADD VALUE 'ONBOARDING_COMPLETE';
ALTER TYPE "SessionState" ADD VALUE 'CUSTOMER_BROWSING';
