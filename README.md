# Prisma Package Manager (ppm)

[![CI](https://github.com/yourusername/ppm/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/ppm/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E=18.0.0-brightgreen)](https://nodejs.org/)

A simple, cross-platform Node.js package manager with lock file, caching, and script support.

## Features
- Install/uninstall/list packages from npm registry
- Custom lock file: `prisma.lock`
- Recursive dependency resolution
- Version constraints (exact, ^, ~, latest)
- Install from lock file
- Update/upgrade commands
- Progress bar/spinner
- Script support (like `npm run`)
- Project config file: `ppm.json`
- Package tarball cache for fast/offline installs
- Cross-platform support (Windows, macOS, Linux)

## Usage

### Install a package
```
ppm install <package>[@version]
```

### Install all from lock file
```
ppm install
```

### Uninstall a package
```
ppm uninstall <package>
```

### List installed packages
```
ppm list
```

### Update a package
```
ppm update <package>
```

### Upgrade all packages
```
ppm upgrade
```

### Run a script from package.json
```
ppm run <script>
```

## Project Config: ppm.json
Example:
```
{
  "name": "my-project",
  "customSettings": {
    "cacheDirectory": "./.ppm-cache",
    "registry": "https://registry.npmjs.org/"
  }
}
```

## Development
- Node.js 18+
- Install dependencies: `npm install`
- Link globally for CLI: `npm link`

## License
MIT
