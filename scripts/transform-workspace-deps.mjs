import fs from "node:fs";
import path from "node:path";

const packagesDir = "packages";
const pkgDirs = fs
  .readdirSync(packagesDir)
  .map((d) => path.join(packagesDir, d))
  .filter((d) => fs.existsSync(path.join(d, "package.json")));

const versions = {};
for (const d of pkgDirs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8"));
  versions[pkg.name] = pkg.version;
}

let totalTransforms = 0;
for (const d of pkgDirs) {
  const file = path.join(d, "package.json");
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  let modified = false;
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!pkg[key]) continue;
    for (const dep of Object.keys(pkg[key])) {
      const val = pkg[key][dep];
      if (typeof val !== "string" || !val.startsWith("workspace:")) continue;
      if (!versions[dep]) {
        throw new Error(`No workspace version found for dep "${dep}" in ${file}`);
      }
      pkg[key][dep] = `^${versions[dep]}`;
      modified = true;
      totalTransforms++;
    }
  }
  if (modified) {
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  }
}

console.log(
  `Transformed ${totalTransforms} workspace:* deps across ${pkgDirs.length} packages`,
);
