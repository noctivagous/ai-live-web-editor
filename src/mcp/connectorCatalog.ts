import type { McpServerInput, McpTransport } from './mcpStore.js'

/**
 * The bundled connector catalog — the friendly layer over the
 * MCP machinery, in the shape the industry converged on (the
 * official MCP registry's server.json): a catalog entry is
 * metadata + publisher + exactly one payload (a local launch
 * spec OR a remote URL) + the inputs the user must supply.
 * Installing an entry materialises it into a plain McpServer
 * in the store, with provenance (see McpServerOrigin).
 *
 * The catalog is bundled and curated by hand; it is NOT a
 * feed, and "curated" is the strongest claim it makes — the
 * official registry itself only verifies namespace ownership.
 */
export interface ConnectorInput {
  /** Destination name: the env var (stdio) or header (remote)
   * the value is delivered as. */
  name: string
  description: string
  isRequired: boolean
  isSecret: boolean
  target: 'env' | 'header'
  /** Header delivery only: the header value with {value}
   * where the input goes, e.g. 'Bearer {value}'. */
  valueTemplate?: string
  default?: string
}

export interface ConnectorEntry {
  /** Reverse-DNS namespaced id, registry style. */
  id: string
  title: string
  /** One line, at most 100 characters (the registry cap). */
  description: string
  version: string
  publisher: { name: string; url?: string }
  docsUrl?: string
  server: {
    name: string
    transport: McpTransport
    command?: string
    args?: string[]
    url?: string
  }
  inputs: ConnectorInput[]
}

export const CONNECTOR_CATALOG: ConnectorEntry[] = [
  {
    id: 'io.modelcontextprotocol/filesystem',
    title: 'Filesystem',
    description: 'Read and write files in a folder you choose — installed pointing at the current folder.',
    version: '1.0.0',
    publisher: { name: 'MCP Reference Servers', url: 'https://github.com/modelcontextprotocol/servers' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    server: { name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
    inputs: [],
  },
  {
    id: 'io.modelcontextprotocol/github',
    title: 'GitHub',
    description: 'Issues, pull requests, repositories and code search on GitHub, as you.',
    version: '1.0.0',
    publisher: { name: 'MCP Reference Servers', url: 'https://github.com/modelcontextprotocol/servers' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    server: { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    inputs: [
      { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', description: 'A GitHub personal access token', isRequired: true, isSecret: true, target: 'env' },
    ],
  },
  {
    id: 'io.modelcontextprotocol/fetch',
    title: 'Fetch',
    description: 'Fetch web pages and bring their content back as markdown.',
    version: '1.0.0',
    publisher: { name: 'MCP Reference Servers', url: 'https://github.com/modelcontextprotocol/servers' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    server: { name: 'fetch', transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
    inputs: [],
  },
  {
    id: 'io.modelcontextprotocol/memory',
    title: 'Memory',
    description: 'A knowledge-graph memory the agent can read and write across chats.',
    version: '1.0.0',
    publisher: { name: 'MCP Reference Servers', url: 'https://github.com/modelcontextprotocol/servers' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    server: { name: 'memory', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    inputs: [],
  },
  {
    id: 'io.modelcontextprotocol/sqlite',
    title: 'SQLite',
    description: 'Query and explore a local SQLite database file.',
    version: '1.0.0',
    publisher: { name: 'MCP Reference Servers', url: 'https://github.com/modelcontextprotocol/servers' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    server: { name: 'sqlite', transport: 'stdio', command: 'uvx', args: ['mcp-server-sqlite', '--db-path', './data.db'] },
    inputs: [],
  },
  {
    id: 'io.modelcontextprotocol/brave-search',
    title: 'Brave Search',
    description: 'Web search through Brave’s index, with your own API key.',
    version: '1.0.0',
    publisher: { name: 'MCP Reference Servers', url: 'https://github.com/modelcontextprotocol/servers' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    server: { name: 'brave-search', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'] },
    inputs: [
      { name: 'BRAVE_API_KEY', description: 'Your Brave Search API key', isRequired: true, isSecret: true, target: 'env' },
    ],
  },
  {
    id: 'dev.chrome/chrome-devtools',
    title: 'Chrome DevTools',
    description: 'Drive a real Chrome — inspect pages, console, network and performance.',
    version: '1.0.0',
    publisher: { name: 'Chrome DevTools team', url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp' },
    docsUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    server: { name: 'chrome-devtools', transport: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
    inputs: [],
  },
  {
    id: 'com.deepwiki/deepwiki',
    title: 'DeepWiki',
    description: 'Ask questions about any public GitHub repository’s documentation and code.',
    version: '1.0.0',
    publisher: { name: 'Cognition', url: 'https://deepwiki.com' },
    docsUrl: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    server: { name: 'deepwiki', transport: 'http', url: 'https://mcp.deepwiki.com/mcp' },
    inputs: [],
  },
  {
    id: 'com.context7/context7',
    title: 'Context7',
    description: 'Up-to-date documentation and code examples for libraries, pulled at ask time.',
    version: '1.0.0',
    publisher: { name: 'Upstash', url: 'https://context7.com' },
    docsUrl: 'https://context7.com/docs/resources/all-clients',
    server: { name: 'context7', transport: 'http', url: 'https://mcp.context7.com/mcp' },
    inputs: [
      { name: 'CONTEXT7_API_KEY', description: 'Optional — an API key raises the rate limits', isRequired: false, isSecret: true, target: 'header' },
    ],
  },
]

export function findConnector(id: string): ConnectorEntry | null {
  return CONNECTOR_CATALOG.find(e => e.id === id) ?? null
}

/**
 * Turn a catalog entry + the values the user typed into the
 * server to store. Pure, so the API and the tests share it.
 * A missing required value is an error, never a silent empty
 * string — an empty secret installs a broken server.
 */
export function buildConnectorInstall(
  entry: ConnectorEntry,
  values: Record<string, string>,
): { ok: true; input: McpServerInput } | { ok: false; error: string } {
  const env: Record<string, string> = {}
  const headers: Record<string, string> = {}
  for (const input of entry.inputs) {
    const value = (typeof values[input.name] === 'string' ? values[input.name].trim() : '') || input.default || ''
    if (!value) {
      if (input.isRequired) return { ok: false, error: `${entry.title} needs ${input.description.charAt(0).toLowerCase() + input.description.slice(1)}.` }
      continue
    }
    if (input.target === 'env') env[input.name] = value
    else headers[input.name] = (input.valueTemplate ?? '{value}').replace('{value}', value)
  }
  return {
    ok: true,
    input: {
      name: entry.server.name,
      transport: entry.server.transport,
      ...(entry.server.transport === 'stdio'
        ? { command: entry.server.command, args: entry.server.args ?? [] }
        : { url: entry.server.url }),
      ...(Object.keys(env).length ? { env } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      origin: { catalogId: entry.id, version: entry.version },
    },
  }
}
