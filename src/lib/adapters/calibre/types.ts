export interface OpdsAcquisition {
	format: string;
	href: string;
	length?: number;
	mtime?: Date;
	mimeType: string;
}

export interface OpdsEntry {
	id: string;
	uuid: string;
	title: string;
	authors: string[];
	publishers: string[];
	language?: string;
	published?: Date;
	updated?: Date;
	categories: string[];
	series?: string;
	seriesIndex?: number;
	ratingStars?: number;
	description?: string;
	coverHref?: string;
	thumbHref?: string;
	acquisitions: OpdsAcquisition[];
}

export interface OpdsFeed {
	totalResults?: number;
	nextHref?: string;
	entries: OpdsEntry[];
}

export interface CalibreFormat {
	name: string;
	downloadUrl: string;
}
