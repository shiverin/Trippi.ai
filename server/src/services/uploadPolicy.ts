// Single authoritative blocklist for every upload surface. Even when an admin
// setting allows wildcard file extensions, these active/scriptable types stay
// blocked.
export const BLOCKED_EXTENSIONS = [
  // Server-rendered / scripted content that could XSS a viewer
  '.svg',
  '.html',
  '.htm',
  '.xml',
  '.xhtml',
  // Scripts
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.php',
  '.py',
  '.rb',
  '.pl',
  // Executables
  '.exe',
  '.bat',
  '.sh',
  '.cmd',
  '.msi',
  '.dll',
  '.com',
  '.vbs',
  '.ps1',
  '.app',
];
