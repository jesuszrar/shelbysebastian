import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TOKEN_BYTES = 48; // generates 96-char hex

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
};

export const hashRefreshToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const createRefreshToken = async (userId: string, token: string, expiresAt: Date) => {
  const tokenHash = hashRefreshToken(token);
  const created = await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });
  return created;
};

export const verifyRefreshToken = async (token: string) => {
  const tokenHash = hashRefreshToken(token);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } as any });
  if (!record) return null;
  if (record.revokedAt) return { record, valid: false };
  if (record.expiresAt.getTime() < Date.now()) return { record, valid: false };
  return { record, valid: true };
};

export const revokeRefreshToken = async (id: string) => {
  return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
};

export const rotateRefreshToken = async (oldId: string, newToken: string, newExpiresAt: Date) => {
  const newHash = hashRefreshToken(newToken);
  // mark old as revoked and set replacedById after creating new
  const old = await prisma.refreshToken.findUnique({ where: { id: oldId } as any });
  if (!old) throw new Error("old refresh token not found");
  const created = await prisma.refreshToken.create({ data: { userId: old.userId, tokenHash: newHash, expiresAt: newExpiresAt } });
  await prisma.refreshToken.update({ where: { id: oldId }, data: { revokedAt: new Date(), replacedById: created.id } });
  return created;
};

export default {
  generateRefreshToken,
  hashRefreshToken,
  createRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
};
