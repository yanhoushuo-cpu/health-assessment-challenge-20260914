-- No browser/Data API policies: only the trusted server owner/BYPASSRLS role
-- may access these tables. Application ownership is checked in the API.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssessmentResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentEvent" ENABLE ROW LEVEL SECURITY;
