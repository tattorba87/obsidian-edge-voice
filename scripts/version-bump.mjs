// `bun run release <x.y.z>`: sets the version in package.json and manifest.json,
// records which Obsidian version it needs in versions.json (as Obsidian's
// plugin directory expects), then commits and tags it. The tag has no "v"
// prefix, because Obsidian looks a release up by the manifest's version.
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
	console.error("Usage: bun run release <x.y.z>");
	process.exit(1);
}

function update(file, change) {
	const data = JSON.parse(readFileSync(file, "utf8"));
	change(data);
	writeFileSync(file, JSON.stringify(data, null, "\t") + "\n");
}

let minAppVersion;
update("package.json", (pkg) => (pkg.version = version));
update("manifest.json", (manifest) => {
	manifest.version = version;
	minAppVersion = manifest.minAppVersion;
});
update("versions.json", (versions) => (versions[version] = minAppVersion));

const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
git("add", "package.json", "manifest.json", "versions.json");
git("commit", "-m", version);
git("tag", version);
