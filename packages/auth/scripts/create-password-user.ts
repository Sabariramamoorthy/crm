import "@crm/env/load";

import { db } from "@crm/db";
import { readAgentModel, writeAgentModel } from "@crm/db/settings";
import { auth } from "../src/auth";
import { isPasswordSignInEnabled } from "../src/env";

const CREDENTIAL_PROVIDER_ID = "credential";
const DEFAULT_CONTEXT_WINDOW = 128_000;

async function ensurePasswordUser(): Promise<void> {
	const email = process.env.CRM_ADMIN_EMAIL?.trim().toLowerCase();
	const password = process.env.CRM_ADMIN_PASSWORD;

	if (!email || !password) {
		console.log(
			"[bootstrap] CRM_ADMIN_EMAIL or CRM_ADMIN_PASSWORD is unset; no password user created.",
		);
		return;
	}

	if (!isPasswordSignInEnabled()) {
		console.log(
			'[bootstrap] AUTH_PASSWORD_SIGN_IN is not "true"; no password user created.',
		);
		return;
	}

	const ctx = await auth.$context;
	const existing = await ctx.internalAdapter.findUserByEmail(email, {
		includeAccounts: true,
	});

	if (existing?.accounts.some((a) => a.providerId === CREDENTIAL_PROVIDER_ID)) {
		console.log(`[bootstrap] ${email} already has a password; left unchanged.`);
		return;
	}

	const user =
		existing?.user ??
		(await ctx.internalAdapter.createUser({
			email,
			name: process.env.CRM_ADMIN_NAME?.trim() || email,
			emailVerified: true,
		}));

	await ctx.internalAdapter.linkAccount({
		userId: user.id,
		providerId: CREDENTIAL_PROVIDER_ID,
		accountId: user.id,
		password: await ctx.password.hash(password),
	});

	console.log(`[bootstrap] password sign-in ready for ${email}.`);
}

async function ensureAgentModel(): Promise<void> {
	const id = process.env.AGENT_MODEL_ID?.trim();
	if (!id) return;

	const current = await readAgentModel(db);
	if (!current.isDefault) return;

	const contextWindowTokens =
		Number(process.env.AGENT_MODEL_CONTEXT_WINDOW) || DEFAULT_CONTEXT_WINDOW;

	await writeAgentModel(db, { id, contextWindowTokens });
	console.log(`[bootstrap] agent model set to ${id}.`);
}

try {
	await ensurePasswordUser();
	await ensureAgentModel();
} finally {
	await db.$disconnect();
}
