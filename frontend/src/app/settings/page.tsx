"use client";

import { useState, useSyncExternalStore } from "react";
import CodeBlock from "@/components/CodeBlock";
import { PlugsConnectedIcon, OpenAiLogoIcon } from "@phosphor-icons/react";
import { PageHeader } from "@/components/PageParts";
import { CARD, FAINT, INLINE_CODE, LINK, MUTED, SECTION_HEADING } from "@/lib/ui";

// Never notifies — the hostname doesn't change during a session, so this
// just gives useSyncExternalStore a safe way to read a browser-only value
// once, without the hydration mismatch a plain useState/useEffect would
// cause (server renders the placeholder, client immediately overwrites it
// mid-render, no cascading-render lint violation either).
function subscribeHost() {
  return () => {};
}
function getHostSnapshot() {
  return window.location.hostname;
}
function getServerHostSnapshot() {
  return "<host>";
}

type ClientKey = "claude-code" | "claude-desktop" | "cursor" | "chatgpt";

const CLIENT_TABS: { key: ClientKey; label: string }[] = [
  { key: "claude-code", label: "Claude Code" },
  { key: "claude-desktop", label: "Claude Desktop" },
  { key: "cursor", label: "Cursor" },
  { key: "chatgpt", label: "ChatGPT / Other" },
];

export default function SettingsPage() {
  // Placeholder on the server (no request context to guess a LAN/Tailscale
  // address from); the browser's own hostname once mounted client-side.
  const host = useSyncExternalStore(subscribeHost, getHostSnapshot, getServerHostSnapshot);
  const [activeClient, setActiveClient] = useState<ClientKey>("claude-code");

  const mcpUrl = `http://${host}:8001/mcp`;

  return (
    <div className="space-y-10 [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:bg-surface-2 [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:font-mono [&_code:not(pre_code)]:text-[0.85em] [&_code:not(pre_code)]:text-fg">
      <PageHeader title="Settings" subtitle="Connect AI assistants to the same tasks you see here." />

      {/* ---- Connect an MCP client -------------------------------------- */}
      <section className="space-y-3">
        <h2 className={SECTION_HEADING}>
          <PlugsConnectedIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
          Connect an MCP client
        </h2>
        <div className={`space-y-4 p-5 ${CARD}`}>
          <p className={`text-sm ${MUTED}`}>
            The MCP server shares this app&apos;s database — connecting a
            client lets it read and manage the exact same tasks you see
            here. It speaks Streamable HTTP at{" "}
            <code className={INLINE_CODE}>
              {mcpUrl}
            </code>{" "}
            (default port 8001 — check <code>MCP_PORT</code> in your{" "}
            <code>.env</code> if you changed it), authenticated with an{" "}
            <code>Authorization: Bearer &lt;API_TOKEN&gt;</code> header. Find
            your <code>API_TOKEN</code> in the server&apos;s <code>.env</code>{" "}
            file — it&apos;s never shown in this UI.
          </p>

          <div role="tablist" aria-label="MCP client" className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
            {CLIENT_TABS.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={activeClient === tab.key}
                onClick={() => setActiveClient(tab.key)}
                className={`h-8 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ${
                  activeClient === tab.key
                    ? "bg-surface text-fg elev-1"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeClient === "claude-code" && (
            <div className="space-y-2">
              <p className={`text-sm ${MUTED}`}>Run this from a terminal:</p>
              <CodeBlock
                code={`claude mcp add --transport http personal-tasks ${mcpUrl} \\\n  --header "Authorization: Bearer <your API_TOKEN>"`}
              />
            </div>
          )}

          {activeClient === "claude-desktop" && (
            <div className="space-y-2">
              <p className={`text-sm ${MUTED}`}>
                Settings → Connectors (or edit{" "}
                <code>claude_desktop_config.json</code> directly, depending on
                your version):
              </p>
              <CodeBlock
                code={`{\n  "mcpServers": {\n    "personal-tasks": {\n      "url": "${mcpUrl}",\n      "headers": {\n        "Authorization": "Bearer <your API_TOKEN>"\n      }\n    }\n  }\n}`}
              />
              <p className={`text-xs ${FAINT}`}>
                If your version only supports locally-spawned (stdio) servers
                instead of remote HTTP ones, see the stdio example in{" "}
                <code>docs/MCP.md</code> in the repo.
              </p>
            </div>
          )}

          {activeClient === "cursor" && (
            <div className="space-y-2">
              <p className={`text-sm ${MUTED}`}>
                MCP settings panel, or edit <code>~/.cursor/mcp.json</code>{" "}
                directly:
              </p>
              <CodeBlock
                code={`{\n  "mcpServers": {\n    "personal-tasks": {\n      "url": "${mcpUrl}",\n      "headers": {\n        "Authorization": "Bearer <your API_TOKEN>"\n      }\n    }\n  }\n}`}
              />
            </div>
          )}

          {activeClient === "chatgpt" && (
            <div className="space-y-2">
              <p className={`text-sm ${MUTED}`}>
                Any client that supports remote MCP servers over Streamable
                HTTP with a custom header can connect with just the URL and
                header above. If a client only supports OAuth-style auth with
                no static bearer option, put a reverse proxy in front that
                injects the header, or use{" "}
                <code>mcp-remote</code> (a small local proxy some clients use
                to bridge stdio-only clients to a remote HTTP MCP server)
                configured with the header.
              </p>
              <p className={`text-sm ${MUTED}`}>
                For ChatGPT specifically, see{" "}
                <a
                  href="#openai-tunnel"
                  className={LINK}
                >
                  OpenAI Secure MCP Tunnel
                </a>{" "}
                below — it doesn&apos;t need any inbound port opened on your
                network.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ---- OpenAI Secure MCP Tunnel ------------------------------------ */}
      <section id="openai-tunnel" className="space-y-3 scroll-mt-6">
        <h2 className={SECTION_HEADING}>
          <OpenAiLogoIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
          ChatGPT via OpenAI Secure MCP Tunnel
        </h2>
        <div className={`space-y-4 p-5 text-sm leading-relaxed ${CARD}`}>
          <p className={MUTED}>
            OpenAI&apos;s{" "}
            <a
              href="https://developers.openai.com/api/docs/guides/secure-mcp-tunnels"
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              Secure MCP Tunnel
            </a>{" "}
            runs a small client (
            <a
              href="https://github.com/openai/tunnel-client"
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              openai/tunnel-client
            </a>
            ) on your own network that makes an{" "}
            <strong className="font-medium text-fg">
              outbound-only
            </strong>{" "}
            connection to OpenAI and relays requests to this MCP server — no
            inbound port is ever opened, and the tunnel carries only MCP
            traffic. An opt-in <code>openai-tunnel</code> service for this is
            already defined in <code>docker-compose.yml</code>.
          </p>

          <ol className="list-decimal space-y-3 pl-5 marker:font-mono marker:text-fg-faint">
            <li>
              Create a tunnel at{" "}
              <a
                href="https://platform.openai.com/settings/organization/tunnels"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                platform.openai.com → Settings → Tunnels
              </a>{" "}
              (needs the Tunnels <em>Read + Manage</em> permission). Associate
              it with your ChatGPT workspace and copy the resulting{" "}
              <code>tunnel_id</code>.
            </li>
            <li>
              Create a runtime API key at{" "}
              <a
                href="https://platform.openai.com/settings/organization/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                platform.openai.com → Settings → API keys
              </a>{" "}
              scoped with Tunnels <em>Read + Use</em>. Both of these are
              account actions in your own browser — this app never sees or
              stores them.
            </li>
            <li>
              Add both to <code>.env</code> on the server:
              <CodeBlock code={`OPENAI_TUNNEL_ID=tunnel_...\nOPENAI_TUNNEL_API_KEY=sk-...`} />
            </li>
            <li>
              Start the tunnel alongside the rest of the stack:
              <CodeBlock code={`docker compose --profile openai-tunnel up -d`} />
              This points <code>ghcr.io/openai/tunnel-client</code> at this
              app&apos;s own <code>mcp</code> service and injects your
              existing <code>API_TOKEN</code> as the bearer header
              automatically — nothing else to configure.
            </li>
            <li>
              Turn on <strong>Developer Mode</strong> in ChatGPT — it&apos;s
              what unlocks adding a custom/unverified connector at all. In
              ChatGPT, open Settings → <strong>Security and login</strong>,
              scroll to the <strong>Developer mode</strong> section, and flip
              the toggle (it&apos;s labeled &quot;Elevated risk&quot; —
              that&apos;s expected for any self-hosted MCP server, not
              specific to this one).
            </li>
            <li>
              Go to <strong>Settings → Plugins</strong> (this is where the{" "}
              <code>#settings/Connectors</code> link actually lands, despite
              the name) → <strong>Browse plugins</strong> → the{" "}
              <strong>+</strong> button to open the &quot;New Plugin&quot;
              dialog.
            </li>
            <li>
              Fill it in:
              <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-fg-faint">
                <li>
                  <strong>Name</strong>: anything, e.g. &quot;Personal
                  Tasks&quot;.
                </li>
                <li>
                  <strong>Connection</strong>: switch from{" "}
                  <em>Server URL</em> to <strong>Tunnel</strong>, then select
                  your tunnel or paste the <code>tunnel_id</code> from step 1.
                </li>
                <li>
                  <strong>Authentication</strong>: choose{" "}
                  <strong>No Auth</strong> — not OAuth. Your{" "}
                  <code>tunnel-client</code> already injects the{" "}
                  <code>Authorization: Bearer</code> header itself on the hop
                  to your MCP server (that&apos;s what{" "}
                  <code>MCP_EXTRA_HEADERS</code> in the compose service does),
                  so ChatGPT never needs to run its own auth handshake with
                  it. Picking OAuth here just makes ChatGPT try (and fail) to
                  discover an OAuth flow your server doesn&apos;t have.
                </li>
                <li>
                  Check <strong>&quot;I understand and want to
                  continue&quot;</strong> under the custom-MCP-server risk
                  warning — standard friction for any self-hosted/unverified
                  server, not a sign something&apos;s wrong.
                </li>
              </ul>
            </li>
            <li>
              Click <strong>Create</strong>. Your tasks are now reachable
              from ChatGPT.
            </li>
          </ol>

          <p className={`text-xs ${FAINT}`}>
            To stop just the tunnel later:{" "}
            <code>docker compose stop openai-tunnel</code>. Full details in{" "}
            <code>docs/DEPLOYMENT.md</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
