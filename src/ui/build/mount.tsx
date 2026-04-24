/// <reference types="vite/client" />
import "../styles/fonts.css";
import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

// Type for component modules loaded via glob import
type ComponentModule = Record<string, React.ComponentType>;

// Auto-import all components using Vite's glob import
// Each component folder must have an index.ts that exports the component as a named export matching the folder name
const componentModules: Record<string, ComponentModule> = import.meta.glob("../components/*/index.ts", {
    eager: true,
});

// Build component registry from glob imports
// Extracts component name from path: "../components/ListDatabases/index.ts" -> "ListDatabases"
const components: Record<string, React.ComponentType> = {};

for (const [path, module] of Object.entries(componentModules)) {
    const match = path.match(/\.\.\/components\/([^/]+)\/index\.ts$/);
    if (match) {
        const componentName = match[1];
        if (!componentName) continue;
        // The component should be exported with the same name as the folder
        const Component = module[componentName];
        if (Component) {
            components[componentName] = Component;
        } else {
            console.warn(
                `[mount] Component "${componentName}" not found in ${path}. ` +
                    `Make sure to export it as: export { ${componentName} } from "./${componentName}.js"`
            );
        }
    }
}

/**
 * Some MCP-UI hosts set the tool iframe’s height to the last `ui-size-change`
 * payload. A **zero** (or sub-pixel) first measure makes the whole widget
 * “disappear” even though the React tree rendered. We enforce a small floor
 * and defer the first report until after a paint.
 */
const MIN_UI_SIZE_PX = 200;

class ToolUiErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { err: null };
    }

    static getDerivedStateFromError(err: Error): { err: Error } {
        return { err };
    }

    override componentDidCatch(err: Error, info: ErrorInfo): void {
        console.error("[mount] Tool UI render error:", err, info?.componentStack);
    }

    override render(): ReactNode {
        if (this.state.err) {
            return (
                <div
                    style={{
                        fontFamily: "system-ui, sans-serif",
                        fontSize: 13,
                        color: "#b91c1c",
                        padding: 16,
                    }}
                >
                    Guide UI error: {this.state.err?.message || String(this.state.err)} (open DevTools for stack)
                </div>
            );
        }
        return this.props.children;
    }
}

/**
 * Notify the host (via postMessage) whenever our content size changes so the
 * iframe can be resized to fit. The `@mcp-ui/server` MCP Apps adapter bridge
 * that wraps this bundle translates `ui-size-change` messages to the
 * `ui/notifications/size-changed` JSON-RPC notification consumed by MCP Apps
 * hosts like Claude. Without this, the iframe defaults to a very small height.
 */
function setupSizeChangeNotifications(): () => void {
    let lastWidth = 0;
    let lastHeight = 0;
    let scheduled = false;

    const measureAndSend = (): void => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            const el = document.documentElement;
            // Temporarily let the root grow to natural content height so we
            // report the full required size rather than the current clipped size.
            const prevHeight = el.style.height;
            el.style.height = "max-content";
            const rawH = el.getBoundingClientRect().height;
            el.style.height = prevHeight;
            const height = Math.max(MIN_UI_SIZE_PX, Math.ceil(rawH));
            const width = Math.max(64, Math.ceil(window.innerWidth));
            if (width === lastWidth && height === lastHeight) return;
            lastWidth = width;
            lastHeight = height;
            window.parent.postMessage(
                { type: "ui-size-change", payload: { width, height } },
                "*"
            );
        });
    };

    // Two rAFs: first paint (incl. React) before measuring, reduces height=0
    // reports that collapse the iframe in strict hosts.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            measureAndSend();
        });
    });

    const observer = new ResizeObserver(measureAndSend);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    return () => observer.disconnect();
}

function mount(): void {
    const container = document.getElementById("root");
    if (!container) {
        console.error("[mount] No #root element found");
        return;
    }

    const componentName = container.dataset.component;
    if (!componentName) {
        console.error("[mount] No data-component attribute found on #root");
        return;
    }

    const Component = components[componentName];
    if (!Component) {
        console.error(`[mount] Unknown component: ${componentName}`);
        console.error(`[mount] Available components: ${Object.keys(components).join(", ")}`);
        return;
    }

    const root = createRoot(container);
    const tree = import.meta.env.DEV ? (
        <React.StrictMode>
            <ToolUiErrorBoundary>
                <Component />
            </ToolUiErrorBoundary>
        </React.StrictMode>
    ) : (
        <ToolUiErrorBoundary>
            <Component />
        </ToolUiErrorBoundary>
    );
    root.render(tree);

    setupSizeChangeNotifications();
}

mount();
