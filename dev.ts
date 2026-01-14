import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev server for Seanime extensions.
 * Serves the 'plugins' directory and dynamically modifies 'manifest.json' files
 * to use local URIs for manifestURI and payloadURI.
 */

const PORT = 8333;
const HOST = '0.0.0.0';
const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

// The remote base URL to be replaced
const REMOTE_BASE =
  'https://raw.githubusercontent.com/dadangdut33/seanime-extensions/refs/heads/master/plugins/';

const server = http.createServer((req, res) => {
  // Enable CORS for development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/plugins/')) {
    pathname = pathname.replace('/plugins/', '/');
  }

  const filePath = path.join(PLUGINS_DIR, pathname);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const stat = fs.statSync(filePath);

  // Directory listing
  if (stat.isDirectory()) {
    const files = fs.readdirSync(filePath);
    const list = files
      .map((file) => {
        const isDir = fs.statSync(path.join(filePath, file)).isDirectory();
        const displayName = isDir ? `${file}/` : file;
        const link = path.join(pathname, file);
        return `<li><a href="${link}">${displayName}</a></li>`;
      })
      .join('');

    console.log(`[DIR] Served listing: ${pathname}`);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
            <html>
            <head>
                <title>Listing for ${pathname}</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; background: #121212; color: #eee; }
                    a { color: #4dabf7; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                    li { margin: 5px 0; }
                    h1 { border-bottom: 1px solid #333; padding-bottom: 10px; }
                </style>
            </head>
            <body>
                <h1>Listing for ${pathname}</h1>
                <ul>
                    <li><a href="${path.join(pathname, '..')}">..</a></li>
                    ${list}
                </ul>
            </body>
            </html>
        `);
    return;
  }

  // Special handling for manifest.json
  if (filePath.endsWith('manifest.json')) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const manifest = JSON.parse(content);

      const localBase = `http://localhost:${PORT}/`;

      // Replace remote URLs with local ones
      if (manifest.manifestURI && typeof manifest.manifestURI === 'string') {
        manifest.manifestURI = manifest.manifestURI.replace(
          REMOTE_BASE,
          localBase
        );
      }
      if (manifest.payloadURI && typeof manifest.payloadURI === 'string') {
        manifest.payloadURI = manifest.payloadURI.replace(
          REMOTE_BASE,
          localBase
        );
      }

      console.log(`[MANIFEST] Served modified: ${pathname}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(manifest, null, 2));
      return;
    } catch (err) {
      console.error(
        `[ERROR] Failed to process manifest.json at ${filePath}:`,
        err
      );
      res.writeHead(500);
      res.end('Internal Server Error');
      return;
    }
  }

  // Serve other files
  console.log(`[FILE] Served: ${pathname}`);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.json': 'application/json',
    '.ts': 'text/typescript',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.html': 'text/html',
    '.css': 'text/css',
  };

  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(
    `\x1b[32m✔ Dev Server running at http://localhost:${PORT}\x1b[0m`
  );
  console.log(`Serving plugins from: ${PLUGINS_DIR}`);
  console.log(`Replacing remote base: ${REMOTE_BASE}\n`);
});
