export const buildAbsoluteUrl = (protocol, host, path = "/") => {
    const normalizedHost = host.replace(/^https?:\/\//i, "").trim();
    const normalizedProtocol = protocol.replace(/:\/\//, "").trim() || "https";
    return new URL(path, `${normalizedProtocol}://${normalizedHost}`).toString();
};
