export const buildAbsoluteUrl = (protocol: string, host: string, path = "/") => {
  const normalizedHost = host.replace(/^https?:\/\//i, "").trim();
  const normalizedProtocol = protocol.replace(/:\/\//, "").trim() || "https";
  return new URL(path, `${normalizedProtocol}://${normalizedHost}`).toString();
};
