import "./env.js";
import { copyProfileToProduction } from "./copy-profile.js";

try {
  copyProfileToProduction();
  console.log("Production database initialized with profile data from test.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}