-- CreateEnum
CREATE TYPE "AccountInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "PasswordCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetTokenHash" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingRegistration" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "activeForEmail" TEXT,
    "tokenHash" TEXT,
    "status" "AccountInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordCredential_userId_key" ON "PasswordCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordCredential_resetTokenHash_key" ON "PasswordCredential"("resetTokenHash");

-- CreateIndex
CREATE INDEX "PasswordCredential_resetExpiresAt_idx" ON "PasswordCredential"("resetExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingRegistration_normalizedEmail_key" ON "PendingRegistration"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "PendingRegistration_tokenHash_key" ON "PendingRegistration"("tokenHash");

-- CreateIndex
CREATE INDEX "PendingRegistration_expiresAt_idx" ON "PendingRegistration"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountInvitation_activeForEmail_key" ON "AccountInvitation"("activeForEmail");

-- CreateIndex
CREATE UNIQUE INDEX "AccountInvitation_tokenHash_key" ON "AccountInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountInvitation_status_expiresAt_idx" ON "AccountInvitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "AccountInvitation_normalizedEmail_createdAt_idx" ON "AccountInvitation"("normalizedEmail", "createdAt");

-- CreateIndex
CREATE INDEX "AccountInvitation_invitedById_idx" ON "AccountInvitation"("invitedById");

-- CreateIndex
CREATE INDEX "AccountInvitation_acceptedById_idx" ON "AccountInvitation"("acceptedById");

-- AddForeignKey
ALTER TABLE "PasswordCredential" ADD CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
