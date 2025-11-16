// Helper to read ppm.json config
function getPPMConfig() {
  const configPath = path.join(process.cwd(), 'ppm.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath));
    } catch (e) {
      console.error('Failed to parse ppm.json:', e.message);
    }
  }
  return {};
}

const { Command } = require('commander');
let fetch;
try {
  fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
} catch (e) {
  console.error('node-fetch not found. Please run `npm install node-fetch`.');
  process.exit(1);
}
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const program = new Command();

program
  .command('run <script> [args...]')
  .description('Run a script defined in package.json (like npm run)')
  .action((script, args = []) => {
    const pkgJsonPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      console.error('No package.json found in this directory.');
      process.exit(1);
    } 
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath));
    const scripts = pkgJson.scripts || {};
    if (!scripts[script]) {
      console.error(`Script '${script}' not found in package.json.`);
      process.exit(1);
    }
    const { spawn } = require('child_process');
    // Use shell to support complex scripts
    const child = spawn(scripts[script], args, { stdio: 'inherit', shell: true });
    child.on('exit', code => process.exit(code));
  });

program
  .command('update <package>')
  .description('Update a package to the latest version')
  .action(async (pkg) => {
    try {
      const lockFile = path.join(process.cwd(), 'prisma.lock');
      let lock = { dependencies: {} };
      if (fs.existsSync(lockFile)) lock = JSON.parse(fs.readFileSync(lockFile));
      const installedSet = new Set();
      // Remove old version from lock and node_modules
      if (lock.dependencies[pkg]) {
        const nodeModules = path.join(process.cwd(), 'node_modules');
        const pkgPath = path.join(nodeModules, pkg);
        if (fs.existsSync(pkgPath)) fs.rmSync(pkgPath, { recursive: true, force: true });
        delete lock.dependencies[pkg];
        fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
      }
      await installPackage(pkg, lock, installedSet);
      console.log(`Updated ${pkg} to latest version.`);
      process.exit(0);
    } catch (err) {
      console.error('Update failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('upgrade')
  .description('Upgrade all packages in prisma.lock to their latest versions')
  .action(async () => {
    try {
      const lockFile = path.join(process.cwd(), 'prisma.lock');
      let lock = { dependencies: {} };
      if (fs.existsSync(lockFile)) lock = JSON.parse(fs.readFileSync(lockFile));
      const pkgs = Object.keys(lock.dependencies);
      if (pkgs.length === 0) {
        console.log('No packages in prisma.lock to upgrade.');
        process.exit(0);
      }
      for (const pkg of pkgs) {
        const installedSet = new Set();
        // Remove old version from lock and node_modules
        const nodeModules = path.join(process.cwd(), 'node_modules');
        const pkgPath = path.join(nodeModules, pkg);
        if (fs.existsSync(pkgPath)) fs.rmSync(pkgPath, { recursive: true, force: true });
        delete lock.dependencies[pkg];
        fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
        await installPackage(pkg, lock, installedSet);
      }
      console.log('All packages upgraded to latest versions.');
      process.exit(0);
    } catch (err) {
      console.error('Upgrade failed:', err.message);
      process.exit(1);
    }
  });

program
  .name('ppm')
  .description('Prisma Package Manager (ppm) - a Node.js package manager CLI')
  .version('0.1.0')
  .addHelpText('after', `

Examples:
  $ ppm install lodash
  $ ppm uninstall lodash
  $ ppm list
  $ ppm update lodash
  $ ppm upgrade
  $ ppm run start

See README.md for more details.
`);



const semverSatisfies = (version, range) => {
  // Very basic semver range support: exact, ^, ~, latest
  if (!range || range === 'latest') return true;
  if (range.startsWith('^')) {
    const major = range.slice(1).split('.')[0];
    return version.startsWith(major + '.');
  }
  if (range.startsWith('~')) {
    const [major, minor] = range.slice(1).split('.');
    return version.startsWith(major + '.' + minor + '.');
  }
  return version === range;
};

async function installPackage(pkgSpec, lock, installedSet, depth = 0) {
  // pkgSpec: e.g. "react@^18.0.0" or "express"
  let [pkg, range] = pkgSpec.split('@');
  if (pkg === '' && range) {
    // e.g. "@babel/core@7.0.0"
    pkg = '@' + range;
    range = undefined;
  }
  // Spinner and progress bar setup
  const spinnerFrames = ['|', '/', '-', '\\'];
  let spinnerIndex = 0;
  function renderProgressBar(phase, percent) {
    const barLength = 25;
    const filled = Math.round(barLength * percent);
    const empty = barLength - filled;
    const bar = '#'.repeat(filled) + '.'.repeat(empty);
    const spin = spinnerFrames[spinnerIndex % spinnerFrames.length];
    process.stdout.write(`\r[${spin}][${bar}] ${phase}`);
    spinnerIndex++;
  }

  // --- CACHE SETUP ---
  const ppmConfig = getPPMConfig();
  const cacheDir = ppmConfig.customSettings && ppmConfig.customSettings.cacheDirectory ? path.resolve(process.cwd(), ppmConfig.customSettings.cacheDirectory) : null;
  if (cacheDir) {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  if (lock.dependencies[pkg]) {
    if (!installedSet.has(pkg)) {
      installedSet.add(pkg);
      console.log(`Already installed: ${pkg}@${lock.dependencies[pkg]}`);
    }
    return;
  }
  try {
    renderProgressBar('Fetching metadata', 0.1);
    const res = await fetch(`https://registry.npmjs.org/${pkg}`);
    if (!res.ok) {
      console.error(`Error: Package '${pkg}' not found in npm registry.`);
      return;
    }
    const meta = await res.json();
    renderProgressBar('Fetching metadata', 0.3);
    await new Promise(r => setTimeout(r, 100));
    // Version resolution
    let version = meta['dist-tags'].latest;
    if (range && range !== 'latest') {
      // Find the highest version that satisfies the range
      const allVersions = Object.keys(meta.versions).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      const found = allVersions.find(v => semverSatisfies(v, range));
      if (found) version = found;
      else {
        console.error(`Error: No version found for ${pkg}@${range}. Available versions: ${allVersions.slice(0,5).join(', ')}...`);
        return;
      }
    }
    const tarballUrl = meta.versions[version].dist.tarball;
    let tarballPath = null;
    let useCache = false;
    if (cacheDir) {
      // Use a safe filename for the tarball
      const safePkg = pkg.replace(/\//g, '__');
      tarballPath = path.join(cacheDir, `${safePkg}-${version}.tgz`);
      if (fs.existsSync(tarballPath)) {
        useCache = true;
      }
    }
    if (!useCache) {
      renderProgressBar(`Downloading ${pkg}@${version}`, 0.5);
      const tarRes = await fetch(tarballUrl);
      if (!tarRes.ok) {
        console.error(`Error: Failed to download tarball for ${pkg}@${version}.`);
        return;
      }
      renderProgressBar(`Downloading ${pkg}@${version}`, 0.7);
      await new Promise(r => setTimeout(r, 100));
      if (tarballPath) {
        // Save tarball to cache
        const fileStream = fs.createWriteStream(tarballPath);
        await new Promise((resolve, reject) => {
          tarRes.body.pipe(fileStream);
          tarRes.body.on('error', reject);
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
        });
      } else {
        // No cache, just extract directly
        renderProgressBar('Extracting package', 0.85);
        const nodeModules = path.join(process.cwd(), 'node_modules');
        if (!fs.existsSync(nodeModules)) fs.mkdirSync(nodeModules);
        const pkgPath = path.join(nodeModules, pkg);
        if (!fs.existsSync(pkgPath)) fs.mkdirSync(pkgPath);
        await new Promise((resolve, reject) => {
          const extract = tar.x({ cwd: pkgPath, strip: 1 });
          tarRes.body.pipe(extract);
          tarRes.body.on('error', reject);
          extract.on('finish', resolve);
          extract.on('error', reject);
        });
        renderProgressBar('Done', 1);
        process.stdout.write('\n');
        // Save to lock
        lock.dependencies[pkg] = version;
        fs.writeFileSync(path.join(process.cwd(), 'prisma.lock'), JSON.stringify(lock, null, 2));
        installedSet.add(pkg);
        // Read package.json for dependencies
        const pkgJsonPath = path.join(pkgPath, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath));
          const deps = pkgJson.dependencies || {};
          for (const dep in deps) {
            if (!installedSet.has(dep)) {
              await installPackage(dep + '@' + deps[dep], lock, installedSet, depth + 1);
            }
          }
        }
        if (depth === 0) {
          console.log(`Installed ${pkg}@${version} and dependencies.`);
        }
        return;
      }
    }
    // Extract from cache
    renderProgressBar('Extracting package', 0.85);
    const nodeModules = path.join(process.cwd(), 'node_modules');
    if (!fs.existsSync(nodeModules)) fs.mkdirSync(nodeModules);
    const pkgPath = path.join(nodeModules, pkg);
    if (!fs.existsSync(pkgPath)) fs.mkdirSync(pkgPath);
    await tar.x({ file: tarballPath, cwd: pkgPath, strip: 1 });
    renderProgressBar('Done', 1);
    process.stdout.write('\n');
    // Save to lock
    lock.dependencies[pkg] = version;
    fs.writeFileSync(path.join(process.cwd(), 'prisma.lock'), JSON.stringify(lock, null, 2));
    installedSet.add(pkg);
    // Read package.json for dependencies
    const pkgJsonPath = path.join(pkgPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath));
      const deps = pkgJson.dependencies || {};
      for (const dep in deps) {
        if (!installedSet.has(dep)) {
          await installPackage(dep + '@' + deps[dep], lock, installedSet, depth + 1);
        }
      }
    }
    if (depth === 0) {
      console.log(`Installed ${pkg}@${version} and dependencies.`);
    }
  } catch (err) {
    console.error(`Install failed for ${pkg}:`, err.message);
    if (err.stack) console.error(err.stack.split('\n')[1]);
  }
}


program
  .command('install [package]')
  .description('Install a package (with dependencies, version constraints supported) or all from prisma.lock')
  .action(async (pkg) => {
    const lockFile = path.join(process.cwd(), 'prisma.lock');
    let lock = { dependencies: {} };
    if (fs.existsSync(lockFile)) lock = JSON.parse(fs.readFileSync(lockFile));
    const installedSet = new Set();
    if (pkg) {
      await installPackage(pkg, lock, installedSet);
    } else {
      const pkgs = Object.entries(lock.dependencies);
      if (pkgs.length === 0) {
        console.log('No packages in prisma.lock to install.');
        return;
      }
      for (const [dep, version] of pkgs) {
        await installPackage(dep + '@' + version, lock, installedSet);
      }
      console.log('All packages from prisma.lock installed.');
    }
  });



program
  .command('uninstall <package>')
  .description('Uninstall a package and prune unused dependencies')
  .action((pkg) => {
    try {
      const nodeModules = path.join(process.cwd(), 'node_modules');
      const pkgPath = path.join(nodeModules, pkg);
      let removed = false;
      if (fs.existsSync(pkgPath)) {
        fs.rmSync(pkgPath, { recursive: true, force: true });
        removed = true;
      }
      // Update prisma.lock
      const lockFile = path.join(process.cwd(), 'prisma.lock');
      let lock = { dependencies: {} };
      if (fs.existsSync(lockFile)) {
        lock = JSON.parse(fs.readFileSync(lockFile));
        delete lock.dependencies[pkg];
        fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
      }
      // Prune unused dependencies
      if (fs.existsSync(nodeModules)) {
        const installed = fs.readdirSync(nodeModules);
        const keep = new Set(Object.keys(lock.dependencies));
        let pruned = 0;
        for (const dep of installed) {
          if (!keep.has(dep)) {
            const depPath = path.join(nodeModules, dep);
            fs.rmSync(depPath, { recursive: true, force: true });
            pruned++;
          }
        }
        if (pruned > 0) {
          console.log(`Pruned ${pruned} unused dependenc${pruned === 1 ? 'y' : 'ies'}.`);
        }
      }
      if (removed) {
        console.log(`Uninstalled ${pkg}`);
      } else {
        console.log(`${pkg} is not installed.`);
      }
    } catch (err) {
      console.error('Uninstall failed:', err.message);
    }
  });


program
  .command('list')
  .description('List installed packages')
  .action(() => {
    const lockFile = path.join(process.cwd(), 'prisma.lock');
    if (fs.existsSync(lockFile)) {
      const lock = JSON.parse(fs.readFileSync(lockFile));
      const deps = lock.dependencies || {};
      if (Object.keys(deps).length === 0) {
        console.log('No packages installed.');
      } else {
        console.log('Installed packages:');
        for (const [pkg, version] of Object.entries(deps)) {
          console.log(`- ${pkg}@${version}`);
        }
      }
    } else {
      console.log('No packages installed.');
    }
  });

program
  .command('help')
  .description('Show detailed help for all ppm commands')
  .action(() => {
    program.outputHelp();
    console.log('\nFor more, see README.md or visit the repository.');
  });

program.parse(process.argv);
