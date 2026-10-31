import path from "path";

export const resolveUploadsDirectory = (moduleFilePath: string): string => {
  let directory = path.dirname(moduleFilePath);

  while (true) {
    const parent = path.dirname(directory);
    if (path.basename(directory).toLowerCase() === "versions" && path.basename(parent).toLowerCase() === "hbuilds") {
      return path.join(path.dirname(parent), "uploads");
    }
    if (parent === directory) break;
    directory = parent;
  }

  return path.join(path.dirname(moduleFilePath), "..", "..", "uploads");
};
