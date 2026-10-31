import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const TOKEN_BYTES = 48; // generates 96-char hex
export const generateRefreshToken = () => {
    return crypto.randomBytes(TOKEN_BYTES).toString("hex");
};
export const hashRefreshToken = (token) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};
export const createRefreshToken = async (userId, token, expiresAt) => {
    return createRefreshTokenWithClient(prisma, userId, token, expiresAt);
};
export const createRefreshTokenWithClient = async (client, userId, token, expiresAt) => {
    const tokenHash = hashRefreshToken(token);
    const created = await client.refreshToken.create({
        data: { userId, tokenHash, expiresAt },
    });
    return created;
};
export const verifyRefreshToken = async (token) => {
    const tokenHash = hashRefreshToken(token);
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record)
        return null;
    if (record.revokedAt)
        return { record, valid: false };
    if (record.expiresAt.getTime() < Date.now())
        return { record, valid: false };
    return { record, valid: true };
};
export const revokeRefreshToken = async (id) => {
    return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
};
export const rotateRefreshToken = async (oldId, newToken, newExpiresAt) => {
    const newHash = hashRefreshToken(newToken);
    return prisma.$transaction(async (transaction) => {
        const old = await transaction.refreshToken.findUnique({ where: { id: oldId } });
        if (!old)
            throw new Error("old refresh token not found");
        const created = await transaction.refreshToken.create({
            data: { userId: old.userId, tokenHash: newHash, expiresAt: newExpiresAt },
        });
        await transaction.refreshToken.update({
            where: { id: oldId },
            data: { revokedAt: new Date(), replacedById: created.id },
        });
        return created;
    });
};
export default {
    generateRefreshToken,
    hashRefreshToken,
    createRefreshToken,
    verifyRefreshToken,
    revokeRefreshToken,
    rotateRefreshToken,
};
