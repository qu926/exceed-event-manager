const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const slug = "exceed-event-manager";
const title = "EXCEED 勤怠・予約管理";
const logoPath = "./assets/exceed-logo.svg";
const homepage = "https://qu926.github.io/exceed-event-manager/";
const repositoryUrl = "https://github.com/qu926/exceed-event-manager.git";
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
]);
const legacyMarkers = [
  ["sample", "event"].join("-"),
  ["Sample", "Event"].join(" "),
  ["event", "manager", "template"].join("-"),
];

function fromRoot(...segments) {
  return path.join(root, ...segments);
}

async function readText(...segments) {
  return fs.readFile(fromRoot(...segments), "utf8");
}

async function loadWindowConfig() {
  const filename = fromRoot("js", "config.js");
  const source = await fs.readFile(filename, "utf8");
  const sandbox = { window: Object.create(null) };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "deployment-config",
  });
  const script = new vm.Script(source, { filename });

  script.runInContext(context, { timeout: 1_000 });
  return sandbox.window.EVENT_MANAGER_CONFIG;
}

async function listTextFiles(directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTextFiles(entryPath));
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

test("package metadata is EXCEED-specific", async () => {
  const packageJson = JSON.parse(await readText("package.json"));
  assert.equal(packageJson.name, slug);
  assert.equal(packageJson.homepage, homepage);
  assert.equal(packageJson.repository?.url, repositoryUrl);
});

test("window config contains the EXCEED deployment identifiers and branding", async () => {
  const config = await loadWindowConfig();

  assert.ok(config && typeof config === "object");
  assert.equal(config.appId, slug);
  assert.equal(config.stateRowId, slug);
  assert.equal(config.brandName, "EXCEED");
  assert.equal(config.title, title);
  assert.equal(config.eyebrow, "EXCEED Event Manager");
  assert.equal(config.logoPath, logoPath);
  assert.equal(config.logoAlt, "EXCEED ロゴ");
  assert.equal(config.core.sitePassword, "exceed");
  assert.equal(config.core.adminPassword, "exceed2026");
});

test("Supabase schema consistently uses the EXCEED state row ID", async () => {
  const schema = await readText("supabase", "schema.sql");
  const policyIds = [...schema.matchAll(/\bid\s*=\s*'([^']+)'/g)]
    .map((match) => match[1]);
  const insertedIds = [...schema.matchAll(/\bvalues\s*\(\s*'([^']+)'/gi)]
    .map((match) => match[1]);
  const stateIds = [...policyIds, ...insertedIds];

  assert.ok(stateIds.length > 0, "schema.sql must contain state row ID checks");
  assert.deepEqual(
    [...new Set(stateIds)],
    [slug],
    "every schema state row ID must match the EXCEED slug",
  );
});

test("index metadata uses the EXCEED title and logo", async () => {
  const html = await readText("index.html");

  assert.match(html, /<title>\s*EXCEED 勤怠・予約管理\s*<\/title>/);
  assert.match(html, /<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']https:\/\/qu926\.github\.io\/exceed-event-manager\/["'])[^>]*>/);
  assert.match(html, /<meta\b(?=[^>]*\bproperty=["']og:url["'])(?=[^>]*\bcontent=["']https:\/\/qu926\.github\.io\/exceed-event-manager\/["'])[^>]*>/);
  assert.match(
    html,
    /<link\b(?=[^>]*\brel=["']icon["'])(?=[^>]*\bhref=["']\.\/assets\/exceed-logo\.svg["'])[^>]*>/,
  );
});

test("README documents the EXCEED deployment slug", async () => {
  const readme = await readText("README.md");

  assert.match(readme, /GitHubリポジトリ名は `exceed-event-manager`/);
  assert.match(readme, /https:\/\/[^/\s]+\.github\.io\/exceed-event-manager\//);
});

test("configured EXCEED logo asset exists and is not empty", async () => {
  const config = await loadWindowConfig();
  const normalizedLogoPath = config.logoPath.replace(/^\.\//, "");
  const logoFile = fromRoot(...normalizedLogoPath.split("/"));
  const stat = await fs.stat(logoFile);

  assert.ok(stat.isFile(), `${config.logoPath} must be a file`);
  assert.ok(stat.size > 0, `${config.logoPath} must not be empty`);
});

test("repository text contains no legacy template branding", async () => {
  const files = await listTextFiles();

  for (const filename of files) {
    const source = await fs.readFile(filename, "utf8");
    for (const marker of legacyMarkers) {
      assert.equal(
        source.includes(marker),
        false,
        `${path.relative(root, filename)} contains legacy marker ${JSON.stringify(marker)}`,
      );
    }
  }
});
