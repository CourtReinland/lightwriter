export { herosJourney } from "./herosJourney";
export { saveTheCat } from "./saveTheCat";
export { proppsFunctions } from "./proppsFunctions";
export { threeActStructure } from "./threeActStructure";
export { computeBeatRanges, estimatePages } from "./utils";
export type { ComputedBeat } from "./utils";
export type { FrameworkDefinition, BeatDefinition } from "./types";

import { herosJourney } from "./herosJourney";
import { saveTheCat } from "./saveTheCat";
import { proppsFunctions } from "./proppsFunctions";
import { threeActStructure } from "./threeActStructure";

export const ALL_FRAMEWORKS = [herosJourney, saveTheCat, proppsFunctions, threeActStructure];
