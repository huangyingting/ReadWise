-- AlterTable: add timezone and streakShields to Profile
ALTER TABLE "Profile" ADD COLUMN "timezone" TEXT;
ALTER TABLE "Profile" ADD COLUMN "streakShields" INTEGER NOT NULL DEFAULT 0;
