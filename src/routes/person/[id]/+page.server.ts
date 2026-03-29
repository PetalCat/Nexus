import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const [personRes, creditsRes] = await Promise.all([
		fetch(`/api/person/${params.id}`),
		fetch(`/api/person/${params.id}/credits`)
	]);
	const person = personRes.ok ? await personRes.json() : null;
	const credits = creditsRes.ok ? await creditsRes.json() : null;
	return { person, credits };
};
