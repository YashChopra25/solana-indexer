import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PLANS } from '@/access/plans';
import { CopyButton } from './copy-button';
import { ENDPOINTS, ERRORS, OBJECTS, type Endpoint, type Param } from './reference';

export const metadata: Metadata = {
  title: 'API Reference · Solana Indexer',
  description: 'Endpoints, parameters, response formats and errors for the Solana Indexer API.',
};

/**
 * /docs — the reference customers read. Public: the proxy lets it through
 * without a key or a login, since you need it before you have either.
 */
export default async function DocsPage() {
  const base = await baseUrl();

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-10 px-4 pb-24 sm:px-8">
      <Sidebar />

      <main className="min-w-0 flex-1">
        <header className="pt-12 pb-6">
          <p className="text-xs uppercase tracking-[0.2em]" style={{ color: 'var(--dim)' }}>
            API reference
          </p>
          <h1 className="font-display mt-3 text-4xl font-700 tracking-tight sm:text-5xl">
            Solana <span className="grad-text">Indexer</span> API
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
            Solana token transfers, swaps, program events and wallet activity as JSON over HTTPS.
            Every endpoint is a GET, returns JSON, and lists data newest first.
          </p>
        </header>

        <Section id="quickstart" title="Quick start">
          <Prose>
            <p>Send your API key in the <Code>Authorization</Code> header on every request:</p>
          </Prose>
          <CodeBlock
            label="Request"
            code={`curl ${base}/api/swaps?limit=1 \\\n  -H "Authorization: Bearer sk_your_key_here"`}
          />
          <Prose>
            <p>
              The base URL is <Code>{base}</Code>. Keep the key secret and call the API from your
              server, not from a browser. If a key leaks, ask us to revoke it and issue a new one.
            </p>
          </Prose>
        </Section>

        <Section id="limits" title="Plans and limits">
          <Prose>
            <p>
              Requests count against your plan&apos;s monthly quota, shared by all your keys. The
              count resets on the 1st of each month (UTC). Every successful response includes:
            </p>
          </Prose>
          <SimpleTable
            head={['Header', 'Meaning']}
            rows={[
              ['X-Quota-Limit', 'Requests your plan allows this month.'],
              ['X-Quota-Remaining', 'Requests left this month, after this one.'],
            ]}
          />
          <SimpleTable
            head={['Plan', 'Requests per month']}
            rows={Object.entries(PLANS).map(([name, plan]) => [name, plan.monthlyRequests.toLocaleString('en-US')])}
          />
        </Section>

        <Section id="conventions" title="Conventions">
          <Prose>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <b>Addresses</b> and <b>signatures</b> are base58. An address is 32 bytes, a
                signature 64. Anything else gets a 400.
              </li>
              <li>
                <b>Amounts are strings</b>, raw integers in the token&apos;s smallest unit. Token
                amounts can exceed what a JSON number holds safely. To display one, divide by{' '}
                <Code>10^decimals</Code>: <Code>&quot;33300000&quot;</Code> with 9 decimals is 0.0333.
              </li>
              <li>
                <b>Times</b> are ISO 8601 in UTC. <Code>blockTime</Code> can be null if the chain
                did not report one.
              </li>
              <li>
                <b>Native SOL</b> uses mint <Code>So11111111111111111111111111111111111111111</Code>,
                which is separate from wrapped SOL (<Code>…112</Code>).
              </li>
              <li>
                <b>symbol</b> is null for most tokens. Identify a token by its <Code>mint</Code>.
              </li>
              <li>
                <b>Pagination</b>: list endpoints take <Code>limit</Code> (default 25, max 100) and{' '}
                <Code>offset</Code>, and return a <Anchor id="pagination">pagination</Anchor> object.
                When <Code>hasMore</Code> is true, request <Code>offset + limit</Code> next.
              </li>
            </ul>
          </Prose>
        </Section>

        <Section id="errors" title="Errors">
          <Prose>
            <p>Errors use standard status codes and always have this JSON body:</p>
          </Prose>
          <CodeBlock label="Response" code={json({ error: 'limit must be at least 1' })} />
          <SimpleTable
            head={['Status', 'When', 'Example error']}
            rows={ERRORS.map((e) => [String(e.status), e.meaning, e.example])}
          />
        </Section>

        <h2 id="endpoints" className="font-display mt-16 scroll-mt-6 text-2xl font-600 tracking-tight">
          Endpoints
        </h2>
        {ENDPOINTS.map((endpoint) => (
          <EndpointDoc key={endpoint.id} endpoint={endpoint} base={base} />
        ))}

        <h2 id="objects" className="font-display mt-16 scroll-mt-6 text-2xl font-600 tracking-tight">
          Response objects
        </h2>
        {OBJECTS.map((object) => (
          <Section key={object.id} id={object.id} title={object.name} small>
            <Prose>
              <p>{object.description}</p>
            </Prose>
            <SimpleTable
              head={['Field', 'Type', 'Description']}
              rows={object.fields.map((f) => [f.name, f.type, f.description])}
              code={[0, 1]}
            />
          </Section>
        ))}
      </main>
    </div>
  );
}

function EndpointDoc({ endpoint, base }: { endpoint: Endpoint; base: string }) {
  const request = `curl "${base}${endpoint.example}" \\\n  -H "Authorization: Bearer sk_your_key_here"`;
  const object = OBJECTS.find((o) => o.id === endpoint.returns);

  return (
    <section id={endpoint.id} className="scroll-mt-6 border-t pt-10 mt-10" style={{ borderColor: 'var(--rule)' }}>
      <h3 className="font-display text-xl font-600 tracking-tight">{endpoint.title}</h3>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span
          className="rounded-md px-2 py-0.5 text-xs font-600"
          style={{ background: 'color-mix(in oklab, var(--deep) 18%, transparent)', color: 'var(--deep)' }}
        >
          GET
        </span>
        <code className="break-all">{endpoint.path}</code>
      </p>
      <Prose>
        <p className="mt-3">{endpoint.summary}</p>
        {endpoint.notes?.map((note) => (
          <p key={note} className="mt-2">
            {note}
          </p>
        ))}
      </Prose>

      <h4 className="mt-6 text-xs uppercase tracking-[0.2em]" style={{ color: 'var(--dim)' }}>
        Parameters
      </h4>
      {endpoint.params.length === 0 ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--dim)' }}>
          None.
        </p>
      ) : (
        <ParamTable params={endpoint.params} />
      )}

      <CodeBlock label="Request" code={request} />
      <CodeBlock
        label={
          <>
            Response · 200
            {object && (
              <>
                {' '}· <Anchor id={object.id}>{object.name}</Anchor>
              </>
            )}
          </>
        }
        code={json(endpoint.response)}
      />
    </section>
  );
}

function ParamTable({ params }: { params: Param[] }) {
  return (
    <SimpleTable
      head={['Name', 'In', 'Type', 'Required', 'Description']}
      rows={params.map((p) => [p.name, p.in, p.type, p.required ? 'yes' : 'no', p.description])}
      code={[0, 2]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */

function Sidebar() {
  const groups: { title: string; links: { id: string; label: string }[] }[] = [
    {
      title: 'Guide',
      links: [
        { id: 'quickstart', label: 'Quick start' },
        { id: 'limits', label: 'Plans and limits' },
        { id: 'conventions', label: 'Conventions' },
        { id: 'errors', label: 'Errors' },
      ],
    },
    { title: 'Endpoints', links: ENDPOINTS.map((e) => ({ id: e.id, label: e.title })) },
    { title: 'Objects', links: OBJECTS.map((o) => ({ id: o.id, label: o.name })) },
  ];

  return (
    <nav className="sticky top-0 hidden max-h-screen w-56 shrink-0 overflow-y-auto py-12 text-sm lg:block">
      {groups.map((group) => (
        <div key={group.title} className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.2em]" style={{ color: 'var(--dim)' }}>
            {group.title}
          </p>
          <ul className="space-y-1">
            {group.links.map((link) => (
              <li key={link.id}>
                <a href={`#${link.id}`} className="block py-0.5 transition-colors hover:text-[var(--ink)]" style={{ color: 'var(--dim)' }}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Section({
  id,
  title,
  small,
  children,
}: {
  id: string;
  title: string;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-6 ${small ? 'mt-8' : 'mt-12'}`}>
      <h2 className={`font-display font-600 tracking-tight ${small ? 'text-lg' : 'text-2xl'}`}>{title}</h2>
      {children}
    </section>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
      {children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all rounded px-1 py-0.5 text-[0.8125rem]" style={{ background: 'var(--panel)', color: 'var(--ink)' }}>
      {children}
    </code>
  );
}

function Anchor({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <a href={`#${id}`} className="underline underline-offset-4" style={{ color: 'var(--cyan)' }}>
      {children}
    </a>
  );
}

function CodeBlock({ label, code }: { label: React.ReactNode; code: string }) {
  return (
    <div className="panel mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2 text-xs" style={{ borderColor: 'var(--rule)', color: 'var(--dim)' }}>
        <span>{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="max-h-[32rem] overflow-auto p-4 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A plain table that scrolls sideways on a phone rather than squashing. */
function SimpleTable({
  head,
  rows,
  code = [],
}: {
  head: string[];
  rows: string[][];
  /** Columns to set in code style. */
  code?: number[];
}) {
  return (
    <div className="panel mt-4 overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs" style={{ color: 'var(--dim)' }}>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-500 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t align-top" style={{ borderColor: 'var(--rule)' }}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-2.5 ${code.includes(j) ? 'whitespace-nowrap text-[0.8125rem]' : ''}`}
                  style={{ color: code.includes(j) || j === 0 ? 'var(--ink)' : 'var(--dim)' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** The URL customers should call: this server, as they reached it. */
async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:8003';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
