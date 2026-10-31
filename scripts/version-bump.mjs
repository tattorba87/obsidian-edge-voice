// Run by `npm version <x.y.z>`: copies the new version into manifest.json and
// records which Obsidian version it needs in versions.json, as Obsidian's
// plugin directory expects.
import { readFileSync, writeFileSync } from "fs";

const version = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
