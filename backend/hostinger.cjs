"use strict";

import("./dist/main.js").catch((error) => {
  console.error("[startup] Failed to load Shelby backend:", error);
  process.exitCode = 1;
});
