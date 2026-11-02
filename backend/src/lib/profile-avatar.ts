import crypto from "node:crypto";
import sharp from "sharp";

export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedFormats = new Map<string, string>([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

export type ProfileAvatarStorage = {
  upload: (objectPath: string, content: Buffer, mimeType: string) => Promise<void>;
  remove: (objectPath: string) => Promise<void>;
  publicUrl: (objectPath: string) => string;
};

export const decodeProfileAvatar = (value: unknown, declaredMimeType: unknown) => {
  const mimeType = typeof declaredMimeType === "string" ? declaredMimeType.trim().toLowerCase() : "";
  if (!allowedMimeTypes.has(mimeType)) throw new Error("Tipo de imagen no permitido");
  if (typeof value !== "string" || !value) throw new Error("Contenido de imagen inválido");
  if (value.length > Math.ceil(PROFILE_AVATAR_MAX_BYTES / 3) * 4 + 64) {
    throw new Error("La imagen supera el tamaño máximo de 5 MB");
  }

  let base64 = value;
  if (value.startsWith("data:")) {
    const dataUrlMatch = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!dataUrlMatch || dataUrlMatch[1].toLowerCase() !== mimeType) {
      throw new Error("Contenido de imagen inválido");
    }
    base64 = dataUrlMatch[2];
  }

  if (!base64 || /\s/.test(base64) || base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Contenido de imagen inválido");
  }
  const content = Buffer.from(base64, "base64");
  if (!content.length || content.toString("base64") !== base64) {
    throw new Error("Contenido de imagen inválido");
  }
  if (content.length > PROFILE_AVATAR_MAX_BYTES) {
    throw new Error("La imagen supera el tamaño máximo de 5 MB");
  }
  return { content, mimeType };
};

export const normalizeProfileAvatar = async (content: Buffer, declaredMimeType: string) => {
  try {
    const image = sharp(content, { failOn: "error", limitInputPixels: 40_000_000, animated: false });
    const metadata = await image.metadata();
    const actualMimeType = metadata.format ? allowedFormats.get(metadata.format) : undefined;
    if (!actualMimeType || actualMimeType !== declaredMimeType) {
      throw new Error("El contenido no coincide con el tipo de imagen declarado");
    }
    if (!metadata.width || !metadata.height || metadata.width < 1 || metadata.height < 1) {
      throw new Error("La imagen no tiene dimensiones válidas");
    }

    const normalized = await image
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
    if (!normalized.length || normalized.length > PROFILE_AVATAR_MAX_BYTES) {
      throw new Error("La imagen procesada supera el tamaño máximo de 5 MB");
    }
    return normalized;
  } catch (error) {
    if (error instanceof Error && /^(El contenido|La imagen)/.test(error.message)) {
      throw error;
    }
    throw new Error("No se pudo procesar la imagen; verifica que sea un JPEG, PNG o WebP válido");
  }
};

export const createSupabaseProfileAvatarStorage = (
  env: NodeJS.ProcessEnv = process.env,
): ProfileAvatarStorage => {
  const supabaseUrl = String(env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const bucket = String(env.SUPABASE_AVATAR_BUCKET ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey || bucket !== "profile-avatars") {
    throw new Error("Profile avatar storage is not configured");
  }

  const encodeObjectPath = (objectPath: string) =>
    objectPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/`;

  return {
    async upload(objectPath, content, mimeType) {
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`,
        {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": mimeType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "x-upsert": "false",
          },
          body: Uint8Array.from(content),
        },
      );
      if (!response.ok) throw new Error("Supabase avatar upload failed");
    },
    async remove(objectPath) {
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
        {
          method: "DELETE",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prefixes: [objectPath] }),
        },
      );
      if (!response.ok) throw new Error("Supabase avatar deletion failed");
    },
    publicUrl(objectPath) {
      return `${publicPrefix}${encodeObjectPath(objectPath)}`;
    },
  };
};

export const getOwnedProfileAvatarPath = (
  avatarUrl: string | null | undefined,
  userId: string,
  storage: Pick<ProfileAvatarStorage, "publicUrl">,
) => {
  if (!avatarUrl) return null;
  const marker = "/storage/v1/object/public/profile-avatars/";
  let expectedUrl: URL;
  let actualUrl: URL;
  try {
    expectedUrl = new URL(storage.publicUrl(`user-avatars/${userId}/placeholder.webp`));
    actualUrl = new URL(avatarUrl);
  } catch {
    return null;
  }
  if (actualUrl.origin !== expectedUrl.origin || !actualUrl.pathname.startsWith(marker)) return null;

  const encodedPath = actualUrl.pathname.slice(marker.length);
  try {
    const objectPath = encodedPath.split("/").map((segment) => decodeURIComponent(segment)).join("/");
    const [prefix, ownerId, filename, ...extra] = objectPath.split("/");
    if (
      prefix !== "user-avatars" ||
      ownerId !== userId ||
      !/^[A-Za-z0-9-]+\.webp$/.test(filename ?? "") ||
      extra.length > 0
    ) return null;
    return objectPath;
  } catch {
    return null;
  }
};

export const createProfileAvatarObjectPath = (userId: string) =>
  `user-avatars/${userId}/${crypto.randomUUID()}.webp`;
