const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const slug = "exceed-event-manager";
const storeSlugs = ["exceed-event-manager", "syndicate-event-manager", "central-event-manager"];
const title = "EXCEED 勤怠・予約管理";
const logoPath = "./assets/exceed-logo.png";
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
  assert.equal(config.storageMode, "supabase");
  assert.equal(config.supabaseUrl, "https://cdnbkbryksrhioajgorg.supabase.co");
  assert.match(config.supabaseAnonKey, /^sb_publishable_/);
  assert.equal(config.producerName, ".EXE PRODUCE");
  assert.equal(config.producerLogoPath, "./assets/exe-produce-logo.png");
  assert.equal(config.brandName, "EXCEED");
  assert.equal(config.title, title);
  assert.equal(config.eyebrow, "EXCEED Event Manager");
  assert.equal(config.logoPath, logoPath);
  assert.equal(config.logoAlt, "EXCEED ロゴ");
  assert.deepEqual([...config.groupStores], ["EXCEED", "SYNDICATE", "THE CENTRAL"]);
  const storeSummary = config.stores.map((store) => ({
    key: store.key,
    appId: store.appId,
    stateRowId: store.stateRowId,
    brandName: store.brandName,
    logoPath: store.logoPath,
    sitePassword: store.sitePassword,
  }));
  assert.equal(
    JSON.stringify(storeSummary),
    JSON.stringify(
      [
        {
          key: "exceed",
          appId: "exceed-event-manager",
          stateRowId: "exceed-event-manager",
          brandName: "EXCEED",
          logoPath,
          sitePassword: "EXCEED",
        },
        {
          key: "syndicate",
          appId: "syndicate-event-manager",
          stateRowId: "syndicate-event-manager",
          brandName: "SYNDICATE",
          logoPath: "./assets/syndicate-logo.png",
          sitePassword: "SYNDICATE",
        },
        {
          key: "central",
          appId: "central-event-manager",
          stateRowId: "central-event-manager",
          brandName: "THE CENTRAL",
          logoPath: "./assets/central-logo.png",
          sitePassword: "CENTRAL",
        },
      ],
    ),
  );
  assert.equal(config.core.sitePassword, "exceed");
  assert.equal(config.core.adminPassword, "exceed2026");
  assert.deepEqual([...config.core.eventWeekdays], [4]);
  assert.equal(config.core.firstWeekHolidayCandidates, false);
  assert.equal(config.core.grandOpenDate, "2026-07-09");
  assert.equal(config.core.preOpenEventNote, "練習会&集団面談");
  assert.equal(config.core.grandOpenEventNote, "グランドオープン");
  assert.deepEqual(Array.from(config.core.eventDates, (event) => event.event_date), [
    "2026-06-11",
    "2026-06-18",
    "2026-06-25",
    "2026-07-09",
    "2026-07-16",
    "2026-07-23",
    "2026-07-30",
  ]);
  assert.deepEqual(Array.from(config.core.eventDates, (event) => event.status || "受付中"), [
    "終了",
    "終了",
    "受付中",
    "受付中",
    "受付中",
    "受付中",
    "受付中",
  ]);
  assert.deepEqual(Array.from(config.core.eventDates, (event) => event.note), [
    "練習会&集団面談",
    "練習会&集団面談",
    "練習会&集団面談",
    "グランドオープン",
    "営業日",
    "営業日",
    "営業日",
  ]);
  assert.ok(!config.core.eventDates.some((event) => event.event_date === "2026-07-02" || event.event_date.startsWith("2026-08")));
});

test("Supabase schema includes every store state row ID", async () => {
  const schema = await readText("supabase", "schema.sql");
  for (const storeSlug of storeSlugs) {
    assert.ok(schema.includes(`'${storeSlug}'`), `schema.sql must include ${storeSlug}`);
  }
});

test("index metadata uses the deployment URL and producer favicon", async () => {
  const html = await readText("index.html");

  assert.match(html, /<title>\s*EXCEED 勤怠・予約管理\s*<\/title>/);
  assert.match(html, /<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']https:\/\/qu926\.github\.io\/exceed-event-manager\/["'])[^>]*>/);
  assert.match(html, /<meta\b(?=[^>]*\bproperty=["']og:url["'])(?=[^>]*\bcontent=["']https:\/\/qu926\.github\.io\/exceed-event-manager\/["'])[^>]*>/);
  assert.match(
    html,
    /<link\b(?=[^>]*\brel=["']icon["'])(?=[^>]*\bhref=["']\.\/assets\/exe-produce-logo\.png(?:\?v=[^"']+)?["'])[^>]*>/,
  );
});

test("README documents the EXCEED deployment slug", async () => {
  const readme = await readText("README.md");

  assert.match(readme, /GitHubリポジトリ名は `exceed-event-manager`/);
  assert.match(readme, /https:\/\/[^/\s]+\.github\.io\/exceed-event-manager\//);
});

test("configured store logo assets exist and are not empty", async () => {
  const config = await loadWindowConfig();
  const logoPaths = [
    config.producerLogoPath,
    ...config.stores.map((store) => store.logoPath),
  ];

  for (const configuredLogoPath of logoPaths) {
    const normalizedLogoPath = configuredLogoPath.replace(/^\.\//, "");
    const logoFile = fromRoot(...normalizedLogoPath.split("/"));
    const stat = await fs.stat(logoFile);

    assert.ok(stat.isFile(), `${configuredLogoPath} must be a file`);
    assert.ok(stat.size > 0, `${configuredLogoPath} must not be empty`);
  }
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
