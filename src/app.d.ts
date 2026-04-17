// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			nexusReason?: string;
		}
		interface Locals {
			user?: {
				id: string;
				username: string;
				displayName: string;
				avatar: string | null;
				isAdmin: boolean;
				status: 'active' | 'pending';
				forcePasswordReset: boolean;
			};
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
