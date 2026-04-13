import { ReactiveResource } from "../resource.js";
import type { UserConfig } from "../../common/config/userConfig.js";
import type { Telemetry } from "../../telemetry/telemetry.js";
import type { Session } from "../../lib.js";
import { PEARL_MANAI_PARSED_REPORTS_GUIDE_MARKDOWN } from "../../common/pearlmanaiParsedReportsGuide.js";

/**
 * Static MCP resource documenting how Pearlman AI uses MongoDB for parsed PDF reports.
 */
export class PearlmanParsedReportsGuideResource extends ReactiveResource<true, readonly []> {
    constructor(session: Session, config: UserConfig, telemetry: Telemetry) {
        super({
            resourceConfiguration: {
                name: "pearlmanai-parsed-reports-guide",
                uri: "guide://pearlmanai/parsed-reports",
                contentMimeType: "text/markdown",
                config: {
                    description:
                        "Pearlman AI: static guide for parsed PDF reports in MongoDB (databases ≈ properties, collections ≈ reports). For a live list of databases and collections, use the pearlmanai-parsed-reports-guide tool.",
                },
            },
            options: {
                initial: true,
                events: [],
            },
            session,
            config,
            telemetry,
        });
    }

    reduce(eventName: undefined, event: undefined): true {
        void eventName;
        void event;
        return this.current;
    }

    toOutput(): string {
        return PEARL_MANAI_PARSED_REPORTS_GUIDE_MARKDOWN;
    }
}
