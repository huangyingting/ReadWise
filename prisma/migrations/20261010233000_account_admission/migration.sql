-- CreateTable
CREATE TABLE "PasswordCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetTokenHash" TEXT,
    "resetExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PendingRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "activeForEmail" TEXT,
    "tokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AccountInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
