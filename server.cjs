const fs = require("fs");
const http = require("http");
const path = require("path");

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
});
const PUBLIC_DIRECTORIES = new Set(["assets", "css", "js"]);

function sendText(req, res, statusCode, message, headers = {}) {
  const body = Buffer.from(message, "utf8");
  res.writeHead(statusCode, {
    "content-length": body.length,
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function isWithinRoot(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function resolveRequestPath(rootPath, requestUrl) {
  const requestTarget =
    typeof requestUrl === "string" && requestUrl.length > 0 ? requestUrl : "/";
  const queryIndex = requestTarget.indexOf("?");
  const encodedPath =
    queryIndex === -1 ? requestTarget : requestTarget.slice(0, queryIndex);

  if (!encodedPath.startsWith("/")) {
    return { statusCode: 400 };
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return { statusCode: 400 };
  }

  if (decodedPath.includes("\0")) {
    return { statusCode: 400 };
  }

  const segments = decodedPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0);

  if (segments.includes("..")) {
    return { statusCode: 403 };
  }

  const normalizedSegments = segments.filter((segment) => segment !== ".");
  const relativePath =
    normalizedSegments.length === 0 ? "index.html" : normalizedSegments.join("/");
  const isPublicPath =
    relativePath === "index.html" ||
    PUBLIC_DIRECTORIES.has(normalizedSegments[0]);

  if (!isPublicPath) {
    return { statusCode: 403 };
  }

  const filePath = path.resolve(rootPath, relativePath);
  if (!isWithinRoot(rootPath, filePath)) {
    return { statusCode: 403 };
  }

  return { filePath, statusCode: 200 };
}

function statusForFileError(error) {
  if (error && ["EACCES", "EPERM"].includes(error.code)) {
    return 403;
  }
  if (error && ["EISDIR", "ENOENT", "ENOTDIR"].includes(error.code)) {
    return 404;
  }
  return 500;
}

function createRequestHandler(options = {}) {
  const rootPath = path.resolve(options.root || __dirname);
  const realRootPathPromise = fs.promises.realpath(rootPath);

  return function requestHandler(req, res) {
    const handle = async () => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendText(req, res, 405, "Method not allowed", { allow: "GET, HEAD" });
        return;
      }

      const resolved = resolveRequestPath(rootPath, req.url);
      if (resolved.statusCode === 400) {
        sendText(req, res, 400, "Bad request");
        return;
      }
      if (resolved.statusCode === 403) {
        sendText(req, res, 403, "Forbidden");
        return;
      }

      let realRootPath;
      let realFilePath;
      try {
        [realRootPath, realFilePath] = await Promise.all([
          realRootPathPromise,
          fs.promises.realpath(resolved.filePath),
        ]);
      } catch (error) {
        const statusCode = statusForFileError(error);
        sendText(
          req,
          res,
          statusCode,
          statusCode === 403
            ? "Forbidden"
            : statusCode === 404
              ? "Not found"
              : "Internal server error",
        );
        return;
      }

      if (!isWithinRoot(realRootPath, realFilePath)) {
        sendText(req, res, 403, "Forbidden");
        return;
      }

      let stats;
      try {
        stats = await fs.promises.stat(realFilePath);
      } catch (error) {
        const statusCode = statusForFileError(error);
        sendText(
          req,
          res,
          statusCode,
          statusCode === 403
            ? "Forbidden"
            : statusCode === 404
              ? "Not found"
              : "Internal server error",
        );
        return;
      }

      if (!stats.isFile()) {
        sendText(req, res, 404, "Not found");
        return;
      }

      const headers = {
        "content-length": stats.size,
        "content-type":
          MIME_TYPES[path.extname(realFilePath).toLowerCase()] ||
          "application/octet-stream",
        "x-content-type-options": "nosniff",
      };

      if (req.method === "HEAD") {
        res.writeHead(200, headers);
        res.end();
        return;
      }

      try {
        const data = await fs.promises.readFile(realFilePath);
        res.writeHead(200, headers);
        res.end(data);
      } catch (error) {
        const statusCode = statusForFileError(error);
        sendText(
          req,
          res,
          statusCode,
          statusCode === 403
            ? "Forbidden"
            : statusCode === 404
              ? "Not found"
              : "Internal server error",
        );
      }
    };

    handle().catch(() => {
      if (!res.headersSent) {
        sendText(req, res, 500, "Internal server error");
      } else {
        res.destroy();
      }
    });
  };
}

function createServer(options = {}) {
  return http.createServer(createRequestHandler(options));
}

function startServer(options = {}) {
  const port = options.port ?? Number(process.env.PORT || 4173);
  const host = options.host || process.env.HOST || "127.0.0.1";
  const server = createServer(options);

  server.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}/`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  MIME_TYPES,
  createRequestHandler,
  createServer,
  isWithinRoot,
  resolveRequestPath,
  startServer,
  statusForFileError,
};
