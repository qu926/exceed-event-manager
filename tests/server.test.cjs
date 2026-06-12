const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const {
  createRequestHandler,
  createServer,
  resolveRequestPath,
  startServer,
} = require("../server.cjs");

let root;
let server;

function request(requestPath, options = {}) {
  const address = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        method: options.method || "GET",
        path: requestPath,
        port: address.port,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
            statusCode: res.statusCode,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "event-manager-server-"));
  await Promise.all([
    fs.mkdir(path.join(root, "assets")),
    fs.mkdir(path.join(root, "css")),
    fs.mkdir(path.join(root, "js")),
  ]);
  await Promise.all([
    fs.writeFile(path.join(root, "index.html"), "<h1>Event manager</h1>"),
    fs.writeFile(
      path.join(root, "assets", "logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ),
    fs.writeFile(path.join(root, "css", "styles.css"), "body { color: black; }"),
    fs.writeFile(path.join(root, "js", "app.js"), "console.log('app');"),
    fs.writeFile(path.join(root, "secret.txt"), "not public"),
  ]);

  server = createServer({ root });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (root) {
    await fs.rm(root, { force: true, recursive: true });
  }
});

test("exports testable handlers without listening on import", () => {
  assert.equal(typeof createRequestHandler, "function");
  assert.equal(typeof createServer, "function");
  assert.equal(typeof resolveRequestPath, "function");
  assert.equal(typeof startServer, "function");
});

test("serves index and public directories with expected MIME types", async () => {
  const indexResponse = await request("/?cache=1");
  assert.equal(indexResponse.statusCode, 200);
  assert.equal(indexResponse.body, "<h1>Event manager</h1>");
  assert.equal(indexResponse.headers["content-type"], "text/html; charset=utf-8");

  const scriptResponse = await request("/js/app.js");
  assert.equal(scriptResponse.statusCode, 200);
  assert.equal(scriptResponse.headers["content-type"], "text/javascript; charset=utf-8");

  const svgResponse = await request("/assets/logo.svg");
  assert.equal(svgResponse.statusCode, 200);
  assert.equal(svgResponse.headers["content-type"], "image/svg+xml");
});

test("HEAD returns GET headers without a response body", async () => {
  const response = await request("/css/styles.css", { method: "HEAD" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "");
  assert.equal(response.headers["content-type"], "text/css; charset=utf-8");
  assert.equal(
    Number(response.headers["content-length"]),
    Buffer.byteLength("body { color: black; }"),
  );
});

test("rejects methods other than GET and HEAD", async () => {
  const response = await request("/", { method: "POST", body: "ignored" });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, "GET, HEAD");
  assert.equal(response.body, "Method not allowed");
});

test("returns 400 for malformed percent encoding and continues serving", async () => {
  const malformedResponse = await request("/assets/%E0%A4%A");
  assert.equal(malformedResponse.statusCode, 400);
  assert.equal(malformedResponse.body, "Bad request");

  const healthyResponse = await request("/");
  assert.equal(healthyResponse.statusCode, 200);
});

test("returns 403 for non-public and traversal paths", async () => {
  const paths = [
    "/secret.txt",
    "/package.json",
    "/assets/%2e%2e/secret.txt",
    "/assets/%2e%2e%5csecret.txt",
  ];

  for (const requestPath of paths) {
    const response = await request(requestPath);
    assert.equal(response.statusCode, 403, requestPath);
    assert.equal(response.body, "Forbidden", requestPath);
  }
});

test("returns 404 for missing files and public directories", async () => {
  const missingResponse = await request("/js/missing.js");
  assert.equal(missingResponse.statusCode, 404);
  assert.equal(missingResponse.body, "Not found");

  const directoryResponse = await request("/assets/");
  assert.equal(directoryResponse.statusCode, 404);
  assert.equal(directoryResponse.body, "Not found");
});
