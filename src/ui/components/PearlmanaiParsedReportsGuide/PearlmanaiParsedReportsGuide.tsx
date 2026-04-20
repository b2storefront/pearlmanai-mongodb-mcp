import { type ReactElement } from "react";
import { useRenderData } from "@lg-mcp/hooks";
import type { PearlmanaiGuideOutput } from "../../../tools/pearlmanai/pearlmanaiParsedReportsGuideTool.js";

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return iso;
    }
}

function formatTimespan(oldest: string | null, newest: string | null): string {
    if (!oldest && !newest) return "No dates";
    if (oldest === newest) return formatDate(oldest);
    return `${formatDate(oldest)} → ${formatDate(newest)}`;
}

interface StylesOptions {
    dark: boolean;
}

function getStyles({ dark }: StylesOptions) {
    const bg = dark ? "#1a1a2e" : "#f8fafc";
    const cardBg = dark ? "#16213e" : "#ffffff";
    const border = dark ? "#2d3561" : "#e2e8f0";
    const text = dark ? "#e2e8f0" : "#1e293b";
    const textMuted = dark ? "#94a3b8" : "#64748b";
    const accent = dark ? "#4f8ef7" : "#2563eb";
    const tagBg = dark ? "#1e3a5f" : "#eff6ff";
    const tagText = dark ? "#93c5fd" : "#1d4ed8";
    const rowHover = dark ? "#1e2d4a" : "#f1f5f9";
    const headerBg = dark ? "#0f172a" : "#f1f5f9";

    return {
        root: {
            fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
            fontSize: "13px",
            color: text,
            background: bg,
            minHeight: "100vh",
            padding: "20px",
            boxSizing: "border-box" as const,
        },
        header: {
            marginBottom: "20px",
        },
        title: {
            fontSize: "18px",
            fontWeight: 700,
            color: accent,
            margin: "0 0 4px 0",
            letterSpacing: "-0.3px",
        },
        subtitle: {
            fontSize: "12px",
            color: textMuted,
            margin: 0,
        },
        grid: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: "16px",
        },
        card: {
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: "10px",
            overflow: "hidden",
            boxShadow: dark
                ? "0 2px 8px rgba(0,0,0,0.4)"
                : "0 1px 4px rgba(0,0,0,0.06)",
        },
        cardHeader: {
            background: headerBg,
            borderBottom: `1px solid ${border}`,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
        },
        dbIcon: {
            width: "28px",
            height: "28px",
            borderRadius: "6px",
            background: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "13px",
        },
        dbName: {
            fontWeight: 600,
            fontSize: "14px",
            color: text,
            wordBreak: "break-all" as const,
        },
        collectionCount: {
            marginLeft: "auto",
            fontSize: "11px",
            color: textMuted,
            whiteSpace: "nowrap" as const,
            flexShrink: 0,
        },
        table: {
            width: "100%",
            borderCollapse: "collapse" as const,
        },
        thRow: {
            background: headerBg,
        },
        th: {
            padding: "7px 12px",
            textAlign: "left" as const,
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase" as const,
            letterSpacing: "0.6px",
            color: textMuted,
            borderBottom: `1px solid ${border}`,
        },
        td: {
            padding: "8px 12px",
            borderBottom: `1px solid ${border}`,
            verticalAlign: "middle" as const,
        },
        trHover: {
            background: rowHover,
        },
        collectionName: {
            fontWeight: 500,
            color: text,
            wordBreak: "break-all" as const,
            fontSize: "12px",
        },
        countBadge: {
            display: "inline-block",
            background: tagBg,
            color: tagText,
            borderRadius: "4px",
            padding: "2px 7px",
            fontSize: "11px",
            fontWeight: 600,
            whiteSpace: "nowrap" as const,
        },
        timespanText: {
            color: textMuted,
            fontSize: "11px",
            whiteSpace: "nowrap" as const,
        },
        emptyRow: {
            padding: "16px",
            color: textMuted,
            fontStyle: "italic" as const,
            fontSize: "12px",
            textAlign: "center" as const,
        },
        emptyState: {
            textAlign: "center" as const,
            padding: "40px 20px",
            color: textMuted,
        },
        loadingText: {
            textAlign: "center" as const,
            padding: "40px",
            color: textMuted,
        },
    };
}

function PropertyCard({
    property,
    dark,
}: {
    property: PearlmanaiGuideOutput["properties"][number];
    dark: boolean;
}): ReactElement {
    const s = getStyles({ dark });
    const initials = property.dbName.slice(0, 2).toUpperCase();

    return (
        <div style={s.card}>
            <div style={s.cardHeader}>
                <div style={s.dbIcon}>{initials}</div>
                <span style={s.dbName}>{property.dbName}</span>
                <span style={s.collectionCount}>
                    {property.collections.length}{" "}
                    {property.collections.length === 1 ? "report" : "reports"}
                </span>
            </div>
            {property.collections.length === 0 ? (
                <div style={s.emptyRow}>No collections</div>
            ) : (
                <table style={s.table}>
                    <thead>
                        <tr style={s.thRow}>
                            <th style={s.th}>Report (collection)</th>
                            <th style={{ ...s.th, textAlign: "center" }}>Docs</th>
                            <th style={s.th}>Timespan</th>
                        </tr>
                    </thead>
                    <tbody>
                        {property.collections.map((col) => (
                            <CollectionRow key={col.name} col={col} s={s} />
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function CollectionRow({
    col,
    s,
}: {
    col: PearlmanaiGuideOutput["properties"][number]["collections"][number];
    s: ReturnType<typeof getStyles>;
}): ReactElement {
    return (
        <tr>
            <td style={s.td}>
                <span style={s.collectionName}>{col.name}</span>
            </td>
            <td style={{ ...s.td, textAlign: "center" }}>
                <span style={s.countBadge}>{col.documentCount}</span>
            </td>
            <td style={s.td}>
                <span style={s.timespanText}>
                    {formatTimespan(col.oldestImportedAt, col.newestImportedAt)}
                </span>
            </td>
        </tr>
    );
}

export const PearlmanaiParsedReportsGuide = (): ReactElement | null => {
    const { data, isLoading, error, darkMode } = useRenderData<PearlmanaiGuideOutput>();
    const dark = darkMode ?? false;
    const s = getStyles({ dark });

    if (isLoading) {
        return <div style={s.loadingText}>Loading inventory…</div>;
    }

    if (error) {
        return <div style={{ ...s.loadingText, color: "#ef4444" }}>Error: {error}</div>;
    }

    const properties = data?.properties ?? [];
    const generatedAt = data?.generatedAt ?? null;

    return (
        <div style={s.root}>
            <div style={s.header}>
                <h2 style={s.title}>Pearlman AI — Properties &amp; Reports</h2>
                <p style={s.subtitle}>
                    {generatedAt
                        ? `Snapshot from ${formatDate(generatedAt)} · `
                        : ""}
                    {properties.length} {properties.length === 1 ? "property" : "properties"} ·{" "}
                    {properties.reduce((n, p) => n + p.collections.length, 0)} reports total
                </p>
            </div>

            {properties.length === 0 ? (
                <div style={s.emptyState}>
                    No non-system databases found on this connection.
                </div>
            ) : (
                <div style={s.grid}>
                    {properties.map((prop) => (
                        <PropertyCard key={prop.dbName} property={prop} dark={dark} />
                    ))}
                </div>
            )}
        </div>
    );
};
