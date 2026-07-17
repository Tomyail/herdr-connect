import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const installerPath = join(repositoryRoot, "install.sh");
const version = "0.1.0-preview.2";
const archiveName = `herdr-connect_${version}_linux_amd64`;
const assetName = `${archiveName}.tar.gz`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "herdr-connect-installer-test-"));
  const releases = join(root, "releases");
  const archiveRoot = join(root, archiveName);
  const fakeBin = join(root, "fake-bin");
  const installDir = join(root, "installed");
  await mkdir(releases);
  await mkdir(archiveRoot);
  await mkdir(fakeBin);
  await writeFile(join(archiveRoot, "herdr-connect"), "fixture daemon\n", { mode: 0o755 });
  execFileSync("tar", ["-czf", join(releases, assetName), "-C", root, archiveName]);

  const archive = await readFile(join(releases, assetName));
  const checksum = createHash("sha256").update(archive).digest("hex");
  await writeFile(join(releases, "SHA256SUMS"), `${checksum}  ./${assetName}\n`);

  const fakeCurl = `#!/bin/sh
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) shift; output="$1" ;;
    https://*) url="$1" ;;
  esac
  shift
done
[ -n "$output" ] && [ -n "$url" ] || exit 2
cp "$FIXTURE_RELEASES/\${url##*/}" "$output"
`;
  await writeFile(join(fakeBin, "curl"), fakeCurl, { mode: 0o755 });
  await chmod(join(fakeBin, "curl"), 0o755);

  return { root, releases, fakeBin, installDir };
}

function installerEnv(paths) {
  return {
    ...process.env,
    FIXTURE_RELEASES: paths.releases,
    HERDR_CONNECT_OS: "linux",
    HERDR_CONNECT_ARCH: "amd64",
    HERDR_CONNECT_INSTALL_DIR: paths.installDir,
    HERDR_CONNECT_DOWNLOAD_BASE_URL: "https://fixtures.invalid/release",
    HOME: paths.root,
    PATH: `${paths.fakeBin}:${process.env.PATH}`,
  };
}

test("installer downloads, verifies, and installs the matching daemon", async () => {
  const paths = await fixture();
  const { stdout } = await execFileAsync("sh", [installerPath], {
    env: installerEnv(paths),
  });

  assert.equal(await readFile(join(paths.installDir, "herdr-connect"), "utf8"), "fixture daemon\n");
  assert.match(stdout, /Installed Herdr Connect v0\.1\.0-preview\.2/);
  assert.match(stdout, /herdr-connect doctor/);
  assert.match(stdout, /herdr-connect service install/);
  assert.match(stdout, /herdr-connect service status/);
});

test("installer tells an existing service to restart after an upgrade", async () => {
  const paths = await fixture();
  const serviceConfig = join(paths.root, ".config", "systemd", "user", "herdr-connect.service");
  await mkdir(join(paths.root, ".config", "systemd", "user"), { recursive: true });
  await writeFile(serviceConfig, "managed service\n");

  const { stdout } = await execFileAsync("sh", [installerPath], { env: installerEnv(paths) });
  assert.match(stdout, /existing service was detected/i);
  assert.match(stdout, /herdr-connect service restart/);
});

test("installer refuses an archive that fails checksum verification", async () => {
  const paths = await fixture();
  await writeFile(join(paths.releases, "SHA256SUMS"), `${"0".repeat(64)}  ./${assetName}\n`);

  await assert.rejects(
    execFileAsync("sh", [installerPath], { env: installerEnv(paths) }),
    (error) => {
      assert.match(error.stderr, /checksum verification failed/);
      return true;
    },
  );
});

test("installer rejects unsupported operating systems before downloading", async () => {
  const paths = await fixture();
  const env = installerEnv(paths);
  env.HERDR_CONNECT_OS = "windows";

  await assert.rejects(
    execFileAsync("sh", [installerPath], { env }),
    (error) => {
      assert.match(error.stderr, /unsupported operating system/);
      return true;
    },
  );
});
