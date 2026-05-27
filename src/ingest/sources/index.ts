import type { ReviewSource } from "../../db/schema";
import type { Connector } from "../types";
import { googleConnector } from "./google";
import { mockConnector } from "./mock";
import { redditConnector } from "./reddit";
import { trustpilotConnector } from "./trustpilot";

/** Registry of connectors by source kind. Add new sources here. */
export const connectors: Record<ReviewSource["kind"], Connector | undefined> = {
	mock: mockConnector,
	reddit: redditConnector,
	trustpilot: trustpilotConnector,
	google: googleConnector,
	// Not yet implemented:
	rss: undefined,
	yelp: undefined,
};

export function getConnector(kind: ReviewSource["kind"]): Connector {
	const connector = connectors[kind];
	if (!connector) {
		throw new Error(`No connector implemented for source kind "${kind}".`);
	}
	return connector;
}
