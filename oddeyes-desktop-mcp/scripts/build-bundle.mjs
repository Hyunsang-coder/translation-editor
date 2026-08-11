import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(packageDir, '..');
const rootPackageJsonPath = path.join(repoRoot, 'package.json');
const rootNodeModulesDir = path.join(repoRoot, 'node_modules');
const distDir = path.join(packageDir, 'dist');
const manifestTemplatePath = path.join(packageDir, 'manifest.template.json');
const buildDir = path.join(packageDir, 'build');
const extensionDir = path.join(buildDir, 'extension');
const bundlePath = path.join(buildDir, 'oddeyes-desktop.mcpb');
const extensionServerDir = path.join(extensionDir, 'server');
const extensionNodeModulesDir = path.join(extensionDir, 'node_modules');

const packageJson = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'));
const manifestTemplate = JSON.parse(await fs.readFile(manifestTemplatePath, 'utf8'));

manifestTemplate.version = packageJson.version;

// maxRetries가 없으면 macOS에서 ENOTEMPTY로 죽는다. fs.rm은 "목록 조회 → 항목 삭제
// → rmdir" 순서라, 그 사이에 Finder가 .DS_Store를 다시 쓰면 마지막 rmdir이 실패한다.
await fs.rm(buildDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
await fs.mkdir(extensionServerDir, { recursive: true });
await fs.mkdir(extensionNodeModulesDir, { recursive: true });

await copyDirectory(distDir, extensionServerDir);
await fs.writeFile(
  path.join(extensionDir, 'package.json'),
  `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    private: true,
    type: 'module',
  }, null, 2)}\n`,
);
await fs.writeFile(
  path.join(extensionDir, 'manifest.json'),
  `${JSON.stringify(manifestTemplate, null, 2)}\n`,
);

const visited = new Set();

for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
  const dependencyPackageDir = await resolveInstalledPackageDir(dependencyName, rootPackageJsonPath);
  await copyPackageTree(path.join(dependencyPackageDir, 'package.json'));
}

await createBundleArchive();

async function copyPackageTree(packageJsonPath) {
  const packageDirPath = path.dirname(packageJsonPath);
  const packageDirKey = path.normalize(packageDirPath);

  if (visited.has(packageDirKey)) {
    return;
  }

  visited.add(packageDirKey);

  const relativePackagePath = path.relative(rootNodeModulesDir, packageDirPath);
  if (relativePackagePath.startsWith('..') || path.isAbsolute(relativePackagePath)) {
    throw new Error(`Cannot bundle dependency outside root node_modules: ${packageDirPath}`);
  }

  const destinationDir = path.join(extensionNodeModulesDir, relativePackagePath);
  await copyDirectory(packageDirPath, destinationDir, { excludeNodeModules: true });

  const dependencyPackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const nextResolver = createRequire(packageJsonPath);
  const dependencyNames = new Set([
    ...Object.keys(dependencyPackageJson.dependencies ?? {}),
    ...Object.keys(dependencyPackageJson.optionalDependencies ?? {}),
  ]);

  for (const dependencyName of dependencyNames) {
    try {
      const nextPackageDir = await resolveInstalledPackageDir(dependencyName, packageJsonPath);
      await copyPackageTree(path.join(nextPackageDir, 'package.json'));
    } catch (error) {
      throw new Error(
        `Failed to resolve transitive dependency "${dependencyName}" required by "${dependencyPackageJson.name}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

async function resolveInstalledPackageDir(packageName, resolverPath) {
  const packageRequire = createRequire(resolverPath);
  const startPaths = [];

  try {
    startPaths.push(packageRequire.resolve(`${packageName}/package.json`));
  } catch {
    // Some packages do not export package.json.
  }

  try {
    startPaths.push(packageRequire.resolve(packageName));
  } catch {
    // Some packages only resolve through explicit subpaths.
  }

  for (const startPath of startPaths) {
    let currentDir = path.dirname(startPath);

    while (true) {
      const candidatePackageJsonPath = path.join(currentDir, 'package.json');
      try {
        const candidatePackageJson = JSON.parse(await fs.readFile(candidatePackageJsonPath, 'utf8'));
        if (candidatePackageJson.name === packageName) {
          return currentDir;
        }
      } catch {
        // Keep walking up until the package root is found.
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  throw new Error(`Unable to find installed package root for ${packageName}`);
}

async function copyDirectory(sourceDir, destinationDir, options = {}) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (options.excludeNodeModules && entry.isDirectory() && entry.name === 'node_modules') {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath, options);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(sourcePath);
      await fs.symlink(linkTarget, destinationPath);
      continue;
    }

    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function createBundleArchive() {
  if (process.platform === 'win32') {
    // Compress-Archive only supports .zip extension, so create as .zip then rename
    const zipPath = bundlePath.replace(/\.mcpb$/, '.zip');
    await fs.rm(zipPath, { force: true });
    await fs.rm(bundlePath, { force: true });
    execFileSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path * -DestinationPath "${zipPath}" -Force`,
      ],
      {
        cwd: extensionDir,
        stdio: 'inherit',
      },
    );
    await fs.rename(zipPath, bundlePath);
    return;
  }

  execFileSync('zip', ['-qr', bundlePath, '.'], {
    cwd: extensionDir,
    stdio: 'inherit',
  });
}
