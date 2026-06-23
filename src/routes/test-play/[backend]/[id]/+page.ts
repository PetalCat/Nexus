import type { PageLoad } from './$types';

/** Throwaway test-harness loader — just surfaces the route params. */
export const load: PageLoad = ({ params }) => {
	return { backend: params.backend, id: params.id };
};
