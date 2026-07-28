const defaultAllowedHosts = ["localhost", "127.0.0.1", "shelbyimportacionessas.com", "www.shelbyimportacionessas.com"];

export const isAllowedCorsOrigin = (origin: string, configuredOrigins: string[] = []) => {
  const normalizedOrigin = origin.toLowerCase();
  const allowedOrigins = [...configuredOrigins, ...defaultAllowedHosts.map((host) => `https://${host}`), ...defaultAllowedHosts.map((host) => `http://${host}`)];

  if (allowedOrigins.includes(normalizedOrigin)) return true;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const bareHostname = hostname.replace(/^www\./, "");
    return defaultAllowedHosts.some((host) => {
      const normalizedHost = host.toLowerCase().replace(/^www\./, "");
      return hostname === normalizedHost || bareHostname === normalizedHost || `www.${normalizedHost}` === hostname || `www.${bareHostname}` === normalizedHost;
    });
  } catch {
    return false;
  }
};
