import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user ?? null,
		buildVersion: process.env.npm_package_version ?? 'dev'
	};
};
