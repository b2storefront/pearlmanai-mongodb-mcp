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

function formatMonth(iso: string | null): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
        });
    } catch {
        return iso;
    }
}

function formatPeriodRange(
    oldest: string | null,
    newest: string | null,
    periodsFound: number,
    totalDocs: number
): string {
    if (periodsFound === 0 || (!oldest && !newest)) return "No period info";
    if (oldest === newest) return formatMonth(oldest);
    const coverage = periodsFound < totalDocs ? ` (${periodsFound}/${totalDocs})` : "";
    return `${formatMonth(oldest)} → ${formatMonth(newest)}${coverage}`;
}

interface StylesOptions {
    dark: boolean;
}

function getStyles({ dark }: StylesOptions) {
    // Palette matched to Claude's brand: warm neutral surfaces with a terracotta accent.
    const bg = dark ? "#262624" : "#faf9f5";
    const cardBg = dark ? "#2f2f2d" : "#ffffff";
    const border = dark ? "#3d3d3a" : "#e8e6dc";
    const text = dark ? "#f5f4ef" : "#3d3929";
    const textMuted = dark ? "#a8a59e" : "#6b6558";
    const accent = "#cc785c";
    const tagBg = dark ? "#3a2f2a" : "#f5ebe4";
    const tagText = dark ? "#e0a089" : "#a05a3f";
    const rowHover = dark ? "#353533" : "#f2f0e8";
    const headerBg = dark ? "#1f1f1d" : "#f2f0e8";

    return {
        root: {
            fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
            fontSize: "13px",
            color: text,
            background: bg,
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
                    {formatPeriodRange(
                        col.oldestPeriod,
                        col.newestPeriod,
                        col.periodsFound,
                        col.documentCount
                    )}
                </span>
            </td>
        </tr>
    );
}

interface McpAppsRenderData {
    toolOutput?: {
        structuredContent?: PearlmanaiGuideOutput;
    };
}

export const PearlmanaiParsedReportsGuide = (): ReactElement | null => {
    const { data, isLoading, error, darkMode } = useRenderData<
        PearlmanaiGuideOutput & McpAppsRenderData
    >();
    const dark = darkMode ?? false;
    const s = getStyles({ dark });

    if (isLoading) {
        return <div style={s.loadingText}>Loading inventory…</div>;
    }

    if (error) {
        return <div style={{ ...s.loadingText, color: "#ef4444" }}>Error: {error}</div>;
    }

    // MCP Apps hosts (e.g. Claude) deliver the tool's CallToolResult via
    // `renderData.toolOutput`, so structured payload lives at
    // `data.toolOutput.structuredContent`. Legacy MCP-UI hosts surface the
    // structured payload at the root of renderData, so fall back to that.
    const structured = data?.toolOutput?.structuredContent ?? (data as PearlmanaiGuideOutput | undefined);
    const properties = structured?.properties ?? [];
    const generatedAt = structured?.generatedAt ?? null;

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
