import { ConfigResource } from "./common/config.js";
import { DebugResource } from "./common/debug.js";
import { ExportedData } from "./common/exportedData.js";
import { PearlmanParsedReportsGuideResource } from "./common/pearlmanParsedReportsGuide.js";

export const Resources = [
    ConfigResource,
    DebugResource,
    ExportedData,
    PearlmanParsedReportsGuideResource,
] as const;
