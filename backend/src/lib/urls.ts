export const buildAbsoluteUrl = (protocol: string, host: string, path = "/") => {
  return new URL(path, `${protocol}://${host}`).toString();
};
