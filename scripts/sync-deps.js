const fs = require('fs');
const path = require('path');

const checkMode = process.argv.includes('--check');

const rootPath = path.resolve(__dirname, '../package.json');
const rootContent = fs.readFileSync(rootPath, 'utf8');
const rootJson = JSON.parse(rootContent);

const dependencyManagement = rootJson.dependencyManagement || {};

const packagesDir = path.resolve(__dirname, '../packages');

if (!fs.existsSync(packagesDir)) {
  fs.mkdirSync(packagesDir, { recursive: true });
}

const packages = fs.readdirSync(packagesDir).filter(f => fs.statSync(path.join(packagesDir, f)).isDirectory());

let mismatchCount = 0;
let updatedCount = 0;

for (const pkg of packages) {
  const pkgJsonPath = path.join(packagesDir, pkg, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) continue;

  const pkgContent = fs.readFileSync(pkgJsonPath, 'utf8');
  const pkgJson = JSON.parse(pkgContent);
  let changed = false;

  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (const field of depFields) {
    if (!pkgJson[field]) continue;

    for (const [depName, version] of Object.entries(pkgJson[field])) {
      // Skip workspace packages or local packages
      if (version.startsWith('workspace:') || depName.startsWith('@polygate/')) {
        continue;
      }

      const managedVersion = dependencyManagement[depName];
      if (managedVersion) {
        if (version !== managedVersion) {
          if (checkMode) {
            console.error(`Mismatch in package ${pkg}: dependency "${depName}" is "${version}", expected "${managedVersion}"`);
            mismatchCount++;
          } else {
            console.log(`Syncing ${pkg}: "${depName}" version updated from "${version}" to "${managedVersion}"`);
            pkgJson[field][depName] = managedVersion;
            changed = true;
            updatedCount++;
          }
        }
      } else {
        // Warning if dependency is not in dependencyManagement
        console.warn(`Warning in package ${pkg}: dependency "${depName}" is not managed in root dependencyManagement`);
      }
    }
  }

  if (changed && !checkMode) {
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
  }
}

if (checkMode) {
  if (mismatchCount > 0) {
    console.error(`Dependency check failed: found ${mismatchCount} mismatched version(s). Run 'npm run sync-deps' to align them.`);
    process.exit(1);
  } else {
    console.log('All workspace dependency versions are aligned with root dependencyManagement.');
  }
} else {
  if (updatedCount > 0) {
    console.log(`Dependency sync completed: updated ${updatedCount} reference(s).`);
  } else {
    console.log('All workspace dependencies are already aligned.');
  }
}
