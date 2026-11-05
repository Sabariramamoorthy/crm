"use client";

import { signIn } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { type FormEvent, useState } from "react";

export function PasswordSignIn() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);

		setPending(true);
		setError(null);

		const { error: failure } = await signIn.email({
			email: String(form.get("email") ?? "").trim(),
			password: String(form.get("password") ?? ""),
			callbackURL: `${window.location.origin}/`,
		});

		if (failure) {
			setPending(false);
			setError(
				failure.status === 401
					? "That email and password don't match. Check both and try again."
					: (failure.message ?? "Could not reach the sign-in service."),
			);
			return;
		}

		window.location.assign("/");
	}

	return (
		<form
			onSubmit={(event) => {
				handleSubmit(event).catch(() => {
					setPending(false);
					setError("Could not reach the sign-in service.");
				});
			}}
		>
			<FieldGroup>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor="sign-in-email">Work email</FieldLabel>
					<Input
						autoComplete="username"
						disabled={pending}
						id="sign-in-email"
						inputMode="email"
						name="email"
						required
						type="email"
					/>
				</Field>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
					<Input
						aria-describedby={error ? "sign-in-error" : undefined}
						autoComplete="current-password"
						disabled={pending}
						id="sign-in-password"
						minLength={12}
						name="password"
						required
						type="password"
					/>
					{error ? (
						<FieldError id="sign-in-error" role="alert">
							{error}
						</FieldError>
					) : null}
				</Field>
				<Button className="w-full" disabled={pending} type="submit">
					{pending ? <Spinner data-icon="inline-start" /> : null}
					Sign in
				</Button>
			</FieldGroup>
		</form>
	);
}
