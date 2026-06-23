import { getRawDb } from '$lib/db';

// Page-anchored collaborative annotations ("stickies"), ported from the tasks
// app. Stored in the Nexus DB; collaborative (any signed-in user can add/clear).

export type Annotation = {
	id: number;
	page_path: string;
	anchor_selector: string;
	anchor_snippet: string;
	anchor_offset_x: number;
	anchor_offset_y: number;
	body: string;
	author: string;
	created_at: number;
};

export type NewAnnotation = Omit<Annotation, 'id' | 'created_at'>;

export function listAnnotations(pagePath: string): Annotation[] {
	return getRawDb()
		.prepare('SELECT * FROM annotations WHERE page_path = ? ORDER BY created_at ASC')
		.all(pagePath) as Annotation[];
}

export function addAnnotation(a: NewAnnotation): Annotation {
	const db = getRawDb();
	const info = db
		.prepare(
			`INSERT INTO annotations
				(page_path, anchor_selector, anchor_snippet, anchor_offset_x, anchor_offset_y, body, author)
			 VALUES (@page_path, @anchor_selector, @anchor_snippet, @anchor_offset_x, @anchor_offset_y, @body, @author)`
		)
		.run(a);
	return db.prepare('SELECT * FROM annotations WHERE id = ?').get(info.lastInsertRowid) as Annotation;
}

export function deleteAnnotation(id: number): boolean {
	return getRawDb().prepare('DELETE FROM annotations WHERE id = ?').run(id).changes > 0;
}
